use crate::errors::{AppError, AppResult};
use crate::models::{
    format_player_duration, ServerDetails, ServerPlayer, ServerSnapshot, ServerSnapshotInput,
};
use crate::steam_launcher;
use chrono::Utc;
use std::time::{Duration, Instant};
use tokio::net::{lookup_host, UdpSocket};
use tokio::time;

const SIMPLE_RESPONSE_HEADER: i32 = -1;
const SPLIT_RESPONSE_HEADER: i32 = -2;
const CHALLENGE_RESPONSE: u8 = 0x41;
const INFO_RESPONSE: u8 = 0x49;
const PLAYER_RESPONSE: u8 = 0x44;
const A2S_INFO: u8 = 0x54;
const A2S_PLAYER: u8 = 0x55;
const DEFAULT_CHALLENGE: i32 = -1;
const MAX_PACKET_SIZE: usize = 1400;
const MAX_SPLIT_PACKETS: usize = 15;

#[derive(Debug, Clone, PartialEq)]
struct A2sInfo {
    name: String,
    map: String,
    game_description: String,
    players: u8,
    max_players: u8,
    bots: u8,
    server_type: String,
    environment: String,
    vac_secured: bool,
    version: String,
    keywords: Vec<String>,
}

pub async fn query_server_details(
    address: &str,
    server_id: Option<&str>,
    fallback_name: Option<&str>,
    timeout: Duration,
) -> AppResult<ServerDetails> {
    let parsed = steam_launcher::parse_server_address(address)?;
    let normalized_address = parsed.as_string();
    let socket_address = resolve_socket_address(&normalized_address).await?;
    let socket = UdpSocket::bind("0.0.0.0:0").await.map_err(|err| {
        AppError::UpstreamUnavailable(format!("failed to bind UDP socket: {err}"))
    })?;
    socket.connect(socket_address).await.map_err(|err| {
        AppError::UpstreamUnavailable(format!("failed to connect UDP socket: {err}"))
    })?;

    let started_at = Instant::now();
    let info = query_info(&socket, timeout).await?;
    let ping_ms = u32::try_from(started_at.elapsed().as_millis()).unwrap_or(u32::MAX);
    let players = query_players(&socket, timeout).await?;
    let name = if info.name.trim().is_empty() {
        fallback_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("")
            .to_string()
    } else {
        info.name.clone()
    };

    let snapshot = ServerSnapshot::try_new(ServerSnapshotInput {
        server_id: server_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        address: normalized_address,
        ip: parsed.ip,
        port: parsed.port,
        name,
        map: info.map,
        mode_tags: info.keywords,
        game_description: Some(info.game_description),
        server_type: Some(info.server_type),
        environment: Some(info.environment),
        version: Some(info.version),
        players: u32::from(info.players),
        max_players: u32::from(info.max_players),
        bots: u32::from(info.bots),
        ping_ms: Some(ping_ms),
        vac_secured: info.vac_secured,
        last_seen_at: Utc::now(),
        last_query_error: None,
    })
    .map_err(AppError::Unexpected)?;

    Ok(ServerDetails { snapshot, players })
}

async fn resolve_socket_address(address: &str) -> AppResult<std::net::SocketAddr> {
    lookup_host(address)
        .await
        .map_err(|err| AppError::InvalidAddress(format!("{address}: {err}")))?
        .next()
        .ok_or_else(|| AppError::InvalidAddress(address.to_string()))
}

async fn query_info(socket: &UdpSocket, timeout: Duration) -> AppResult<A2sInfo> {
    let request = info_request(None);
    match send_query(socket, &request, timeout).await? {
        QueryResponse::Payload(payload) => parse_info_response(&payload),
        QueryResponse::Challenge(challenge) => {
            let request = info_request(Some(challenge));
            match send_query(socket, &request, timeout).await? {
                QueryResponse::Payload(payload) => parse_info_response(&payload),
                QueryResponse::Challenge(_) => Err(AppError::UpstreamUnavailable(
                    "A2S_INFO returned repeated challenge".to_string(),
                )),
            }
        }
    }
}

async fn query_players(socket: &UdpSocket, timeout: Duration) -> AppResult<Vec<ServerPlayer>> {
    let request = player_request(DEFAULT_CHALLENGE);
    match send_query(socket, &request, timeout).await? {
        QueryResponse::Payload(payload) => parse_player_response(&payload),
        QueryResponse::Challenge(challenge) => {
            let request = player_request(challenge);
            match send_query(socket, &request, timeout).await? {
                QueryResponse::Payload(payload) => parse_player_response(&payload),
                QueryResponse::Challenge(_) => Err(AppError::UpstreamUnavailable(
                    "A2S_PLAYER returned repeated challenge".to_string(),
                )),
            }
        }
    }
}

fn info_request(challenge: Option<i32>) -> Vec<u8> {
    let mut request = Vec::from(SIMPLE_RESPONSE_HEADER.to_le_bytes());
    request.push(A2S_INFO);
    request.extend_from_slice(b"Source Engine Query\0");
    if let Some(challenge) = challenge {
        request.extend_from_slice(&challenge.to_le_bytes());
    }
    request
}

fn player_request(challenge: i32) -> Vec<u8> {
    let mut request = Vec::from(SIMPLE_RESPONSE_HEADER.to_le_bytes());
    request.push(A2S_PLAYER);
    request.extend_from_slice(&challenge.to_le_bytes());
    request
}

enum QueryResponse {
    Payload(Vec<u8>),
    Challenge(i32),
}

async fn send_query(
    socket: &UdpSocket,
    request: &[u8],
    timeout: Duration,
) -> AppResult<QueryResponse> {
    socket
        .send(request)
        .await
        .map_err(|err| AppError::UpstreamUnavailable(format!("failed to send A2S query: {err}")))?;
    let payload = receive_payload(socket, timeout).await?;
    if payload.first().copied() == Some(CHALLENGE_RESPONSE) {
        let mut reader = ByteReader::new(&payload[1..]);
        return Ok(QueryResponse::Challenge(reader.read_i32()?));
    }

    Ok(QueryResponse::Payload(payload))
}

async fn receive_payload(socket: &UdpSocket, timeout: Duration) -> AppResult<Vec<u8>> {
    let mut first_packet = vec![0; MAX_PACKET_SIZE];
    let first_size = receive_packet(socket, &mut first_packet, timeout).await?;
    first_packet.truncate(first_size);
    let mut reader = ByteReader::new(&first_packet);
    let header = reader.read_i32()?;

    match header {
        SIMPLE_RESPONSE_HEADER => Ok(first_packet[4..].to_vec()),
        SPLIT_RESPONSE_HEADER => receive_split_payload(socket, first_packet, timeout).await,
        value => Err(AppError::UpstreamUnavailable(format!(
            "A2S response had unsupported header {value}"
        ))),
    }
}

async fn receive_packet(
    socket: &UdpSocket,
    buffer: &mut [u8],
    timeout: Duration,
) -> AppResult<usize> {
    time::timeout(timeout, socket.recv(buffer))
        .await
        .map_err(|_| AppError::NetworkTimeout)?
        .map_err(|err| {
            AppError::UpstreamUnavailable(format!("failed to receive A2S response: {err}"))
        })
}

async fn receive_split_payload(
    socket: &UdpSocket,
    first_packet: Vec<u8>,
    timeout: Duration,
) -> AppResult<Vec<u8>> {
    let first = parse_split_packet(&first_packet)?;
    let total = first.total;
    let mut parts: Vec<Option<Vec<u8>>> = vec![None; usize::from(total)];
    insert_split_part(&mut parts, first)?;

    while parts.iter().any(Option::is_none) {
        let mut packet = vec![0; MAX_PACKET_SIZE];
        let size = receive_packet(socket, &mut packet, timeout).await?;
        packet.truncate(size);
        let part = parse_split_packet(&packet)?;
        if part.total != total {
            return Err(AppError::UpstreamUnavailable(
                "A2S split response changed packet count".to_string(),
            ));
        }
        insert_split_part(&mut parts, part)?;
    }

    Ok(parts.into_iter().flatten().flatten().collect::<Vec<u8>>())
}

#[derive(Debug)]
struct SplitPacket {
    total: u8,
    number: u8,
    payload: Vec<u8>,
}

fn parse_split_packet(packet: &[u8]) -> AppResult<SplitPacket> {
    let mut reader = ByteReader::new(packet);
    let header = reader.read_i32()?;
    if header != SPLIT_RESPONSE_HEADER {
        return Err(AppError::UpstreamUnavailable(
            "A2S split response contained a non-split packet".to_string(),
        ));
    }

    let id = reader.read_i32()?;
    if (id as u32 & 0x8000_0000) != 0 {
        return Err(AppError::UpstreamUnavailable(
            "compressed A2S split packets are not supported".to_string(),
        ));
    }

    let total = reader.read_u8()?;
    let number = reader.read_u8()?;
    let _size = reader.read_u16()?;
    if total == 0 || usize::from(total) > MAX_SPLIT_PACKETS || number >= total {
        return Err(AppError::UpstreamUnavailable(
            "A2S split response had invalid packet numbering".to_string(),
        ));
    }

    Ok(SplitPacket {
        total,
        number,
        payload: reader.remaining().to_vec(),
    })
}

fn insert_split_part(parts: &mut [Option<Vec<u8>>], part: SplitPacket) -> AppResult<()> {
    let slot = parts.get_mut(usize::from(part.number)).ok_or_else(|| {
        AppError::UpstreamUnavailable("A2S split packet index out of range".to_string())
    })?;
    if slot.is_some() {
        return Err(AppError::UpstreamUnavailable(
            "A2S split response repeated a packet".to_string(),
        ));
    }
    *slot = Some(part.payload);
    Ok(())
}

fn parse_info_response(payload: &[u8]) -> AppResult<A2sInfo> {
    let mut reader = ByteReader::new(payload);
    let response_type = reader.read_u8()?;
    if response_type != INFO_RESPONSE {
        return Err(AppError::UpstreamUnavailable(format!(
            "A2S_INFO returned unexpected response type 0x{response_type:02x}"
        )));
    }

    let _protocol = reader.read_u8()?;
    let name = reader.read_cstring()?;
    let map = reader.read_cstring()?;
    let _folder = reader.read_cstring()?;
    let game_description = reader.read_cstring()?;
    let _app_id = reader.read_u16()?;
    let players = reader.read_u8()?;
    let max_players = reader.read_u8()?;
    let bots = reader.read_u8()?;
    let server_type = describe_server_type(reader.read_u8()?);
    let environment = describe_environment(reader.read_u8()?);
    let _visibility = reader.read_u8()?;
    let vac_secured = reader.read_u8()? != 0;
    let version = reader.read_cstring()?;
    let mut keywords = Vec::new();

    if !reader.is_empty() {
        let edf = reader.read_u8()?;
        if edf & 0x80 != 0 {
            let _port = reader.read_u16()?;
        }
        if edf & 0x10 != 0 {
            let _steam_id = reader.read_u64()?;
        }
        if edf & 0x40 != 0 {
            let _spectator_port = reader.read_u16()?;
            let _spectator_name = reader.read_cstring()?;
        }
        if edf & 0x20 != 0 {
            keywords = split_keywords(&reader.read_cstring()?);
        }
        if edf & 0x01 != 0 {
            let _game_id = reader.read_u64()?;
        }
    }

    Ok(A2sInfo {
        name,
        map,
        game_description,
        players,
        max_players,
        bots,
        server_type,
        environment,
        vac_secured,
        version,
        keywords,
    })
}

fn parse_player_response(payload: &[u8]) -> AppResult<Vec<ServerPlayer>> {
    let mut reader = ByteReader::new(payload);
    let response_type = reader.read_u8()?;
    if response_type != PLAYER_RESPONSE {
        return Err(AppError::UpstreamUnavailable(format!(
            "A2S_PLAYER returned unexpected response type 0x{response_type:02x}"
        )));
    }

    let count = reader.read_u8()?;
    let mut players = Vec::with_capacity(usize::from(count));
    for _ in 0..count {
        let _index = reader.read_u8()?;
        let name = reader.read_cstring()?;
        let score = reader.read_i32()?;
        let duration_sec = reader.read_f32()?;
        players.push(ServerPlayer {
            name,
            score,
            duration_sec,
            duration_formatted: format_player_duration(f64::from(duration_sec)),
        });
    }

    Ok(players)
}

fn describe_server_type(value: u8) -> String {
    match value as char {
        'd' => "Dedicated".to_string(),
        'l' => "Listen".to_string(),
        'p' => "SourceTV".to_string(),
        other => other.to_string(),
    }
}

fn describe_environment(value: u8) -> String {
    match value as char {
        'l' => "Linux".to_string(),
        'w' => "Windows".to_string(),
        'm' | 'o' => "Mac".to_string(),
        other => other.to_string(),
    }
}

fn split_keywords(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

struct ByteReader<'a> {
    bytes: &'a [u8],
    index: usize,
}

impl<'a> ByteReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, index: 0 }
    }

    fn is_empty(&self) -> bool {
        self.index >= self.bytes.len()
    }

    fn remaining(&self) -> &'a [u8] {
        &self.bytes[self.index..]
    }

    fn read_u8(&mut self) -> AppResult<u8> {
        let value = *self.bytes.get(self.index).ok_or_else(truncated_response)?;
        self.index += 1;
        Ok(value)
    }

    fn read_u16(&mut self) -> AppResult<u16> {
        let bytes = self.read_array::<2>()?;
        Ok(u16::from_le_bytes(bytes))
    }

    fn read_i32(&mut self) -> AppResult<i32> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    fn read_u64(&mut self) -> AppResult<u64> {
        let bytes = self.read_array::<8>()?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn read_f32(&mut self) -> AppResult<f32> {
        let bytes = self.read_array::<4>()?;
        Ok(f32::from_le_bytes(bytes))
    }

    fn read_cstring(&mut self) -> AppResult<String> {
        let Some(offset) = self.bytes[self.index..]
            .iter()
            .position(|value| *value == 0)
        else {
            return Err(truncated_response());
        };
        let end = self.index + offset;
        let value = String::from_utf8_lossy(&self.bytes[self.index..end]).into_owned();
        self.index = end + 1;
        Ok(value)
    }

    fn read_array<const N: usize>(&mut self) -> AppResult<[u8; N]> {
        let end = self.index + N;
        let slice = self
            .bytes
            .get(self.index..end)
            .ok_or_else(truncated_response)?;
        self.index = end;
        slice
            .try_into()
            .map_err(|_| AppError::Unexpected("failed to copy A2S response bytes".to_string()))
    }
}

fn truncated_response() -> AppError {
    AppError::UpstreamUnavailable("A2S response was truncated".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::UdpSocket;

    fn push_cstring(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(value.as_bytes());
        bytes.push(0);
    }

    fn sample_info_payload() -> Vec<u8> {
        let mut payload = vec![INFO_RESPONSE, 17];
        push_cstring(&mut payload, "Valve Left4Dead 2 Hong Kong Server");
        push_cstring(&mut payload, "c12m4_barn");
        push_cstring(&mut payload, "left4dead2");
        push_cstring(&mut payload, "Left 4 Dead 2");
        payload.extend_from_slice(&550u16.to_le_bytes());
        payload.extend_from_slice(&[3, 4, 1, b'd', b'l', 0, 1]);
        push_cstring(&mut payload, "2.2.4.3");
        payload.push(0x20);
        push_cstring(&mut payload, "coop,secure");
        payload
    }

    fn sample_player_payload() -> Vec<u8> {
        let mut payload = vec![PLAYER_RESPONSE, 1, 0];
        push_cstring(&mut payload, "Alice");
        payload.extend_from_slice(&15i32.to_le_bytes());
        payload.extend_from_slice(&1524.47f32.to_le_bytes());
        payload
    }

    #[test]
    fn parses_info_response_into_snapshot_fields() {
        let info = parse_info_response(&sample_info_payload()).unwrap();

        assert_eq!(info.name, "Valve Left4Dead 2 Hong Kong Server");
        assert_eq!(info.map, "c12m4_barn");
        assert_eq!(info.game_description, "Left 4 Dead 2");
        assert_eq!(info.players, 3);
        assert_eq!(info.max_players, 4);
        assert_eq!(info.bots, 1);
        assert_eq!(info.server_type, "Dedicated");
        assert_eq!(info.environment, "Linux");
        assert!(info.vac_secured);
        assert_eq!(info.version, "2.2.4.3");
        assert_eq!(
            info.keywords,
            vec!["coop".to_string(), "secure".to_string()]
        );
    }

    #[test]
    fn parses_player_response_into_players() {
        let players = parse_player_response(&sample_player_payload()).unwrap();

        assert_eq!(players.len(), 1);
        assert_eq!(players[0].name, "Alice");
        assert_eq!(players[0].score, 15);
        assert!((players[0].duration_sec - 1524.47).abs() < 0.01);
        assert_eq!(players[0].duration_formatted, "25m24s");
    }

    #[test]
    fn parses_uncompressed_split_packets() {
        let mut first = Vec::new();
        first.extend_from_slice(&SPLIT_RESPONSE_HEADER.to_le_bytes());
        first.extend_from_slice(&123i32.to_le_bytes());
        first.extend_from_slice(&[2, 0]);
        first.extend_from_slice(&12u16.to_le_bytes());
        first.extend_from_slice(b"hello ");

        let mut second = Vec::new();
        second.extend_from_slice(&SPLIT_RESPONSE_HEADER.to_le_bytes());
        second.extend_from_slice(&123i32.to_le_bytes());
        second.extend_from_slice(&[2, 1]);
        second.extend_from_slice(&12u16.to_le_bytes());
        second.extend_from_slice(b"world");

        let part_a = parse_split_packet(&first).unwrap();
        let part_b = parse_split_packet(&second).unwrap();
        let mut parts: Vec<Option<Vec<u8>>> = vec![None; usize::from(part_a.total)];
        insert_split_part(&mut parts, part_a).unwrap();
        insert_split_part(&mut parts, part_b).unwrap();
        let payload = parts.into_iter().flatten().flatten().collect::<Vec<_>>();

        assert_eq!(payload, b"hello world");
    }

    #[test]
    fn rejects_compressed_split_packets() {
        let mut packet = Vec::new();
        packet.extend_from_slice(&SPLIT_RESPONSE_HEADER.to_le_bytes());
        packet.extend_from_slice(&i32::MIN.to_le_bytes());
        packet.extend_from_slice(&[1, 0]);
        packet.extend_from_slice(&12u16.to_le_bytes());

        let error = parse_split_packet(&packet).unwrap_err();
        assert!(error.to_string().contains("compressed"));
    }

    #[tokio::test]
    async fn info_query_retries_once_after_challenge() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        client.connect(server_addr).await.unwrap();

        let server_task = tokio::spawn(async move {
            let mut buffer = [0; MAX_PACKET_SIZE];
            let (first_size, peer) = server.recv_from(&mut buffer).await.unwrap();
            assert_eq!(buffer[4], A2S_INFO);
            assert_eq!(&buffer[first_size - 1..first_size], &[0]);

            let mut challenge = Vec::from(SIMPLE_RESPONSE_HEADER.to_le_bytes());
            challenge.push(CHALLENGE_RESPONSE);
            challenge.extend_from_slice(&42i32.to_le_bytes());
            server.send_to(&challenge, peer).await.unwrap();

            let (second_size, peer) = server.recv_from(&mut buffer).await.unwrap();
            assert_eq!(buffer[4], A2S_INFO);
            assert_eq!(&buffer[second_size - 4..second_size], &42i32.to_le_bytes());

            let mut response = Vec::from(SIMPLE_RESPONSE_HEADER.to_le_bytes());
            response.extend_from_slice(&sample_info_payload());
            server.send_to(&response, peer).await.unwrap();
        });

        let info = query_info(&client, Duration::from_secs(1)).await.unwrap();
        server_task.await.unwrap();

        assert_eq!(info.map, "c12m4_barn");
    }

    #[tokio::test]
    async fn receive_packet_times_out() {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let peer = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        socket.connect(peer.local_addr().unwrap()).await.unwrap();
        let mut buffer = [0; MAX_PACKET_SIZE];

        let error = receive_packet(&socket, &mut buffer, Duration::from_millis(10))
            .await
            .unwrap_err();

        assert!(matches!(error, AppError::NetworkTimeout));
    }

    #[tokio::test]
    async fn query_details_rejects_invalid_address_before_udp_query() {
        let error = query_server_details(
            "https://1.2.3.4:27015",
            None,
            None,
            Duration::from_millis(10),
        )
        .await
        .unwrap_err();

        assert!(matches!(error, AppError::InvalidAddress(_)));
    }
}
