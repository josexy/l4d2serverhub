use crate::errors::{AppError, AppResult};
use crate::models::{
    CustomRulePriority, HttpProxyMode, HttpProxySettings, PublicServersPageRequest, ServerDetails,
    ServerDetailsRequest, ServerDetailsResponse, ServerListResponse, ServerPlayer,
    ServerQueryParams, ServerQueryResult, ServerSnapshot, ServerSnapshotInput, ServerSort,
};
use crate::steam_launcher;
use async_trait::async_trait;
use chrono::{DateTime, NaiveDateTime, Utc};
use reqwest::multipart::Form;
use std::time::Duration;

const DEFAULT_POST_URL: &str = "https://zhrradiant.com/wp-admin/admin-ajax.php";
const DEFAULT_PUBLIC_SERVERS_URL: &str = "https://zhrradiant.com/servers/public";
const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const DEFAULT_ORIGIN: &str = "https://zhrradiant.com";
const DEFAULT_GROUP: &str = "public";
const DEFAULT_NONCE: &str = "f0a98e670f";
const LIST_ACTION: &str = "l4d2_get_public_servers_page";
const LIST_BY_ADDRESSES_ACTION: &str = "l4d2_get_public_servers_by_addresses";
const EMPTY_MAPS: &str = "[]";
const EMPTY_MODES: &str = "";
#[async_trait]
pub trait UpstreamServerClient: Send + Sync {
    async fn query_servers(&self, params: &ServerQueryParams) -> AppResult<ServerQueryResult>;
    async fn get_server_details(
        &self,
        server_id: &str,
        fallback_address: Option<&str>,
        fallback_name: Option<&str>,
    ) -> AppResult<ServerDetails>;
}

#[derive(Debug, Clone)]
pub struct UpstreamApiConfig {
    pub post_url: String,
    pub public_servers_url: String,
    pub user_agent: String,
    pub origin: String,
    pub group: String,
    pub nonce: String,
}

impl Default for UpstreamApiConfig {
    fn default() -> Self {
        Self {
            post_url: DEFAULT_POST_URL.to_string(),
            public_servers_url: DEFAULT_PUBLIC_SERVERS_URL.to_string(),
            user_agent: DEFAULT_USER_AGENT.to_string(),
            origin: DEFAULT_ORIGIN.to_string(),
            group: DEFAULT_GROUP.to_string(),
            nonce: DEFAULT_NONCE.to_string(),
        }
    }
}

#[derive(Clone)]
pub struct HttpUpstreamServerClient {
    client: reqwest::Client,
    config: UpstreamApiConfig,
}

impl HttpUpstreamServerClient {
    pub fn new(timeout: Duration, http_proxy: &HttpProxySettings) -> AppResult<Self> {
        Self::with_config_and_proxy(timeout, UpstreamApiConfig::default(), http_proxy)
    }

    pub fn with_config(timeout: Duration, config: UpstreamApiConfig) -> AppResult<Self> {
        Self::with_config_and_proxy(timeout, config, &HttpProxySettings::default())
    }

    pub fn with_config_and_proxy(
        timeout: Duration,
        config: UpstreamApiConfig,
        http_proxy: &HttpProxySettings,
    ) -> AppResult<Self> {
        let client = client_builder(timeout, http_proxy)?
            .build()
            .map_err(|err| AppError::Unexpected(err.to_string()))?;

        Ok(Self { client, config })
    }

    pub async fn startup_config(
        timeout: Duration,
        http_proxy: &HttpProxySettings,
    ) -> AppResult<UpstreamApiConfig> {
        let mut config = UpstreamApiConfig::default();
        let client = client_builder(timeout, http_proxy)?
            .build()
            .map_err(|err| AppError::Unexpected(err.to_string()))?;
        config.nonce = fetch_public_servers_nonce(&client, &config).await?;
        Ok(config)
    }

    async fn post_form(&self, operation: &str, form: Form) -> AppResult<String> {
        let response = self
            .client
            .post(&self.config.post_url)
            .header(reqwest::header::ORIGIN, &self.config.origin)
            .header(reqwest::header::USER_AGENT, &self.config.user_agent)
            .multipart(form)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        let body = response.text().await.map_err(map_reqwest_error)?;

        log::debug!("{operation} upstream HTTP response status: {status}");
        log::trace!("{operation} upstream HTTP response body:\n{body}");

        if !status.is_success() {
            log::warn!("{operation} upstream returned non-success HTTP status: {status}");
            return Err(AppError::UpstreamUnavailable(format!(
                "upstream returned HTTP {status}"
            )));
        }

        Ok(body)
    }

    fn log_request_fields(&self, operation: &str, fields: &[(&str, String)]) {
        log::debug!(
            "{operation} upstream HTTP request: POST {}, origin={}, user_agent={}, content-type=multipart/form-data",
            self.config.post_url, self.config.origin, self.config.user_agent
        );

        for (name, value) in fields {
            log::trace!("{operation} form field {name}={value}");
        }
    }

    fn list_request(&self, params: &ServerQueryParams) -> PublicServersPageRequest {
        let addresses = params
            .addresses
            .as_ref()
            .filter(|addresses| !addresses.is_empty())
            .cloned();

        PublicServersPageRequest {
            action: if addresses.is_some() {
                LIST_BY_ADDRESSES_ACTION
            } else {
                LIST_ACTION
            }
            .to_string(),
            custom_rules: serialize_custom_rules(&params.filters.custom_rules),
            group: self.config.group.clone(),
            include_players: 0,
            maps: EMPTY_MAPS.to_string(),
            modes: serialize_modes(&params.filters.mode_selections),
            nonce: self.config.nonce.clone(),
            page: params.page as i64,
            page_size: params.page_size as i64,
            query: params.filters.query.clone(),
            show_empty: if params.filters.show_empty { 1 } else { 0 },
            show_official: if params.filters.show_official { 1 } else { 0 },
            show_online: if params.filters.show_online { 1 } else { 0 },
            show_third: if params.filters.show_third { 1 } else { 0 },
            sort: params.sort.as_upstream_value().to_string(),
            addresses,
        }
    }

    fn details_request(&self, server_id: &str) -> ServerDetailsRequest {
        ServerDetailsRequest {
            action: "get_server_details".to_string(),
            group: self.config.group.clone(),
            nonce: self.config.nonce.clone(),
            server: server_id.to_string(),
        }
    }

    fn log_list_request(&self, request: &PublicServersPageRequest) {
        self.log_request_fields(
            "query_servers",
            &[
                ("action", request.action.clone()),
                ("group", request.group.clone()),
                ("page", request.page.to_string()),
                ("page_size", request.page_size.to_string()),
                ("query", request.query.clone()),
                ("show_online", request.show_online.to_string()),
                ("show_empty", request.show_empty.to_string()),
                ("show_official", request.show_official.to_string()),
                ("show_third", request.show_third.to_string()),
                ("modes", request.modes.clone()),
                ("maps", request.maps.clone()),
                ("sort", request.sort.clone()),
                ("include_players", request.include_players.to_string()),
                ("custom_rules", request.custom_rules.clone()),
                ("nonce", request.nonce.clone()),
                (
                    "addresses",
                    request
                        .addresses
                        .as_ref()
                        .map(|addresses| {
                            serde_json::to_string(addresses).unwrap_or_else(|_| "[]".to_string())
                        })
                        .unwrap_or_default(),
                ),
            ],
        );
    }

    fn log_details_request(&self, request: &ServerDetailsRequest) {
        self.log_request_fields(
            "get_server_details",
            &[
                ("action", request.action.clone()),
                ("server", request.server.clone()),
                ("group", request.group.clone()),
                ("nonce", request.nonce.clone()),
            ],
        );
    }
}

async fn fetch_public_servers_nonce(
    client: &reqwest::Client,
    config: &UpstreamApiConfig,
) -> AppResult<String> {
    let response = client
        .get(&config.public_servers_url)
        .header(reqwest::header::USER_AGENT, &config.user_agent)
        .send()
        .await
        .map_err(map_reqwest_error)?;
    let status = response.status();
    let body = response.text().await.map_err(map_reqwest_error)?;

    if !status.is_success() {
        return Err(AppError::UpstreamUnavailable(format!(
            "nonce page returned HTTP {status}"
        )));
    }

    extract_public_servers_nonce(&body)
}

fn extract_public_servers_nonce(html: &str) -> AppResult<String> {
    const SEARCH_WINDOW: usize = 4_000;
    const ACTION_MARKERS: [&str; 4] = [
        "formData.append('action', 'l4d2_get_public_servers_page')",
        "formData.append(\"action\", \"l4d2_get_public_servers_page\")",
        "formData.append('action', 'l4d2_get_public_servers_by_addresses')",
        "formData.append(\"action\", \"l4d2_get_public_servers_by_addresses\")",
    ];

    for marker in ACTION_MARKERS {
        let Some(marker_index) = html.find(marker) else {
            continue;
        };
        let end = html.len().min(marker_index + SEARCH_WINDOW);
        if let Some(nonce) = extract_form_data_nonce(&html[marker_index..end]) {
            return Ok(nonce);
        }
    }

    Err(AppError::UpstreamUnavailable(
        "failed to find public server nonce in upstream page".to_string(),
    ))
}

fn extract_form_data_nonce(source: &str) -> Option<String> {
    const NONCE_MARKERS: [&str; 2] = ["formData.append('nonce',", "formData.append(\"nonce\","];

    NONCE_MARKERS
        .iter()
        .find_map(|marker| {
            source
                .find(marker)
                .and_then(|index| parse_js_string_argument(&source[index + marker.len()..]))
        })
        .filter(|nonce| is_valid_nonce(nonce))
}

fn parse_js_string_argument(source: &str) -> Option<String> {
    let source = source.trim_start();
    let quote = source.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }

    let mut value = String::new();
    let mut escaped = false;
    for character in source[quote.len_utf8()..].chars() {
        if escaped {
            value.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return Some(value);
        } else {
            value.push(character);
        }
    }

    None
}

fn is_valid_nonce(nonce: &str) -> bool {
    nonce.len() == 10 && nonce.chars().all(|character| character.is_ascii_hexdigit())
}

fn client_builder(
    timeout: Duration,
    http_proxy: &HttpProxySettings,
) -> AppResult<reqwest::ClientBuilder> {
    http_proxy.validate().map_err(AppError::InvalidSettings)?;

    let builder = reqwest::Client::builder().timeout(timeout);
    match http_proxy.mode {
        HttpProxyMode::None => Ok(builder.no_proxy()),
        HttpProxyMode::System => Ok(builder),
        HttpProxyMode::Custom => {
            let proxy = reqwest::Proxy::all(http_proxy.custom_url.trim())
                .map_err(|err| AppError::InvalidSettings(err.to_string()))?;
            Ok(builder.no_proxy().proxy(proxy))
        }
    }
}

#[async_trait]
impl UpstreamServerClient for HttpUpstreamServerClient {
    async fn query_servers(&self, params: &ServerQueryParams) -> AppResult<ServerQueryResult> {
        let request = self.list_request(params);
        log::debug!(
            "query_servers upstream request summary: page={}, page_size={}, query='{}', addresses={}, proxy_fields_ready=true",
            request.page,
            request.page_size,
            request.query,
            request.addresses.as_ref().map_or(0, Vec::len)
        );
        self.log_list_request(&request);
        let body = self.post_form("query_servers", list_form(&request)).await?;
        let payload = parse_response_body::<ServerListResponse>("query_servers", &body)?;

        if !payload.success {
            return Err(AppError::UpstreamUnavailable(
                "upstream reported an unsuccessful server list response".to_string(),
            ));
        }

        let result = map_list_response(&payload, params.page, params.page_size)?;
        log::info!(
            "query_servers upstream response mapped: items={}, total={}, page={}",
            result.items.len(),
            result.total,
            result.page
        );
        Ok(result)
    }

    async fn get_server_details(
        &self,
        server_id: &str,
        fallback_address: Option<&str>,
        fallback_name: Option<&str>,
    ) -> AppResult<ServerDetails> {
        let request = self.details_request(server_id);
        log::debug!("get_server_details upstream request summary: server_id='{server_id}'");
        self.log_details_request(&request);
        let body = self
            .post_form("get_server_details", details_form(&request))
            .await?;
        let payload = parse_response_body::<ServerDetailsResponse>("get_server_details", &body)?;

        if !payload.success {
            return Err(AppError::UpstreamUnavailable(format!(
                "upstream reported an unsuccessful detail response for '{}'",
                server_id
            )));
        }

        let details = map_details_response(server_id, &payload, fallback_address, fallback_name)?;
        log::info!(
            "get_server_details upstream response mapped: server_id='{}', address='{}', players={}",
            server_id,
            details.snapshot.address,
            details.players.len()
        );
        Ok(details)
    }
}

fn parse_response_body<T>(operation: &str, body: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_str(body).map_err(|err| {
        AppError::UpstreamUnavailable(format!(
            "failed to parse {operation} upstream response JSON: {err}"
        ))
    })
}

fn list_form(request: &PublicServersPageRequest) -> Form {
    let form = Form::new()
        .text("action", request.action.clone())
        .text("group", request.group.clone())
        .text("page", request.page.to_string())
        .text("page_size", request.page_size.to_string())
        .text("query", request.query.clone())
        .text("show_online", request.show_online.to_string())
        .text("show_empty", request.show_empty.to_string())
        .text("show_official", request.show_official.to_string())
        .text("show_third", request.show_third.to_string())
        .text("modes", request.modes.clone())
        .text("maps", request.maps.clone())
        .text("sort", request.sort.clone())
        .text("include_players", request.include_players.to_string())
        .text("custom_rules", request.custom_rules.clone())
        .text("nonce", request.nonce.clone());

    match &request.addresses {
        Some(addresses) => form.text(
            "addresses",
            serde_json::to_string(addresses).unwrap_or_else(|_| "[]".to_string()),
        ),
        None => form,
    }
}

fn details_form(request: &ServerDetailsRequest) -> Form {
    Form::new()
        .text("action", request.action.clone())
        .text("server", request.server.clone())
        .text("group", request.group.clone())
        .text("nonce", request.nonce.clone())
}

fn map_list_response(
    payload: &ServerListResponse,
    requested_page: usize,
    requested_page_size: usize,
) -> AppResult<ServerQueryResult> {
    let refreshed_at = Utc::now();
    let items = payload
        .data
        .items
        .iter()
        .map(|(server_id, item)| {
            let mapped_address = payload
                .data
                .servers
                .get(server_id)
                .ok_or_else(|| {
                    AppError::UpstreamUnavailable(format!(
                        "upstream omitted server address mapping for '{}'",
                        server_id
                    ))
                })?
                .clone();

            if mapped_address != item.addr {
                return Err(AppError::UpstreamUnavailable(format!(
                    "upstream returned mismatched addresses for '{}'",
                    server_id
                )));
            }

            snapshot_from_list_item(server_id, &mapped_address, item, refreshed_at)
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(ServerQueryResult {
        items,
        page: usize::try_from(payload.data.pagination.current_page).map_err(out_of_range_error)?,
        page_size: usize::try_from(payload.data.pagination.page_size)
            .map_err(out_of_range_error)?,
        total: usize::try_from(payload.data.pagination.total_count).map_err(out_of_range_error)?,
        refreshed_at: Some(refreshed_at),
    }
    .with_requested_fallbacks(requested_page, requested_page_size))
}

fn map_details_response(
    server_id: &str,
    payload: &ServerDetailsResponse,
    fallback_address: Option<&str>,
    fallback_name: Option<&str>,
) -> AppResult<ServerDetails> {
    let data = &payload.data;
    let address = detail_response_address(data, fallback_address)?;
    let name = detail_response_name(&data.basic_info, fallback_name);
    let snapshot = snapshot_from_basic_info(
        Some(server_id.to_string()),
        &address,
        name,
        &data.basic_info,
        parse_optional_query_time(data.query_time.as_deref())?,
    )?;
    let players = data
        .players
        .iter()
        .map(|player| {
            Ok(ServerPlayer {
                name: player.name.clone(),
                score: i32::try_from(player.score).map_err(out_of_range_error)?,
                duration_sec: player.duration as f32,
                duration_formatted: player.duration_formatted.clone(),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(ServerDetails { snapshot, players })
}

fn detail_response_name(info: &crate::models::BasicInfo, fallback_name: Option<&str>) -> String {
    let upstream_name = info.name.trim();
    let fallback_name = fallback_name.map(str::trim).filter(|name| !name.is_empty());

    if !info.online {
        if let Some(name) = fallback_name {
            return name.to_string();
        }
    }

    upstream_name.to_string()
}

fn detail_response_address(
    data: &crate::models::ServerDetailsData,
    fallback_address: Option<&str>,
) -> AppResult<String> {
    let upstream_address = data.addr.trim();
    if !upstream_address.is_empty() {
        return Ok(upstream_address.to_string());
    }

    fallback_address
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::UpstreamUnavailable(
                "upstream detail response omitted addr and no fallback address was available"
                    .to_string(),
            )
        })
}

fn snapshot_from_list_item(
    server_id: &str,
    address: &str,
    item: &crate::models::ServerInfoItem,
    refreshed_at: DateTime<Utc>,
) -> AppResult<ServerSnapshot> {
    let parsed = steam_launcher::parse_server_address(address)?;

    ServerSnapshot::try_new(ServerSnapshotInput {
        server_id: Some(server_id.to_string()),
        address: parsed.as_string(),
        ip: parsed.ip,
        port: parsed.port,
        name: item.name.clone(),
        map: item.map.clone(),
        mode_tags: split_keywords(&item.keywords),
        game_description: Some(item.game_desc.clone()),
        server_type: Some(item.server_type.clone()),
        environment: Some(item.environment.clone()),
        version: Some(item.version.clone()),
        players: u32::try_from(item.players.online).map_err(out_of_range_error)?,
        max_players: u32::try_from(item.players.max).map_err(out_of_range_error)?,
        bots: u32::try_from(item.bots).map_err(out_of_range_error)?,
        ping_ms: Some(u32::try_from(item.ping).map_err(out_of_range_error)?),
        vac_secured: item.vac != 0,
        last_seen_at: refreshed_at,
        last_query_error: None,
    })
    .map_err(AppError::Unexpected)
}

fn snapshot_from_basic_info(
    server_id: Option<String>,
    address: &str,
    name: String,
    info: &crate::models::BasicInfo,
    last_seen_at: DateTime<Utc>,
) -> AppResult<ServerSnapshot> {
    let parsed = steam_launcher::parse_server_address(address)?;

    ServerSnapshot::try_new(ServerSnapshotInput {
        server_id,
        address: parsed.as_string(),
        ip: parsed.ip,
        port: parsed.port,
        name,
        map: info.map.clone(),
        mode_tags: split_keywords(&info.keywords),
        game_description: Some(info.game_desc.clone()),
        server_type: Some(info.server_type.clone()),
        environment: Some(info.environment.clone()),
        version: Some(info.version.clone()),
        players: u32::try_from(info.players.online).map_err(out_of_range_error)?,
        max_players: u32::try_from(info.players.max).map_err(out_of_range_error)?,
        bots: u32::try_from(info.bots).map_err(out_of_range_error)?,
        ping_ms: Some(u32::try_from(info.ping).map_err(out_of_range_error)?),
        vac_secured: info.vac != 0,
        last_seen_at,
        last_query_error: None,
    })
    .map_err(AppError::Unexpected)
}

fn split_keywords(keywords: &str) -> Vec<String> {
    keywords
        .split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_query_time(value: &str) -> AppResult<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map(|parsed| DateTime::from_naive_utc_and_offset(parsed, Utc))
        .map_err(|err| {
            AppError::UpstreamUnavailable(format!("invalid upstream query_time '{}': {err}", value))
        })
}

fn parse_optional_query_time(value: Option<&str>) -> AppResult<DateTime<Utc>> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => parse_query_time(value),
        None => Ok(Utc::now()),
    }
}

fn map_reqwest_error(err: reqwest::Error) -> AppError {
    if err.is_timeout() {
        AppError::NetworkTimeout
    } else {
        AppError::UpstreamUnavailable(err.to_string())
    }
}

fn out_of_range_error(err: impl ToString) -> AppError {
    AppError::UpstreamUnavailable(format!(
        "upstream numeric value out of range: {}",
        err.to_string()
    ))
}

trait QueryResultFallbackExt {
    fn with_requested_fallbacks(self, requested_page: usize, requested_page_size: usize) -> Self;
}

impl QueryResultFallbackExt for ServerQueryResult {
    fn with_requested_fallbacks(
        mut self,
        requested_page: usize,
        requested_page_size: usize,
    ) -> Self {
        if self.page == 0 {
            self.page = requested_page.max(1);
        }
        if self.page_size == 0 {
            self.page_size = requested_page_size;
        }
        self
    }
}

impl ServerSort {
    pub fn as_upstream_value(&self) -> &'static str {
        match self {
            ServerSort::None => "none",
            ServerSort::PlayersDesc => "players_desc",
            ServerSort::PlayersAsc => "players_asc",
        }
    }
}

fn serialize_custom_rules(rules: &crate::models::ServerCustomRules) -> String {
    serde_json::json!({
        "priority": match rules.priority {
            CustomRulePriority::Whitelist => "whitelist",
            CustomRulePriority::Blacklist => "blacklist",
        },
        "whitelist": {
            "ip": rules.whitelist.ip.clone(),
            "text": rules.whitelist.text.clone(),
        },
        "blacklist": {
            "ip": rules.blacklist.ip.clone(),
            "text": rules.blacklist.text.clone(),
        },
    })
    .to_string()
}

fn serialize_modes(mode_selections: &[String]) -> String {
    let selections = mode_selections
        .iter()
        .map(|mode| mode.trim())
        .filter(|mode| !mode.is_empty())
        .collect::<Vec<_>>();

    if selections.is_empty() {
        EMPTY_MODES.to_string()
    } else {
        selections.join(",")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn list_response_json() -> String {
        r#"{
            "success": true,
            "data": {
                "servers": {
                    "server854": "103.28.54.212:27035"
                },
                "items": {
                    "server854": {
                        "online": true,
                        "name": "Valve Left4Dead 2 Hong Kong Server",
                        "map": "c12m4_barn",
                        "players": {
                            "online": 3,
                            "max": 4
                        },
                        "ping": 883,
                        "game_desc": "Left 4 Dead 2",
                        "keywords": "coop,secure",
                        "version": "2.2.4.3",
                        "server_type": "专用服务器",
                        "environment": "Linux",
                        "vac": 1,
                        "bots": 0,
                        "addr": "103.28.54.212:27035",
                        "playerList": []
                    }
                },
                "pagination": {
                    "enabled": false,
                    "pageSize": 500,
                    "totalCount": 247,
                    "totalOnline": 247,
                    "totalPages": 1,
                    "currentPage": 1
                }
            }
        }"#
        .to_string()
    }

    fn details_response_json() -> String {
        r#"{
            "success": true,
            "data": {
                "online": true,
                "name": "Valve Left4Dead 2 Hong Kong Server",
                "map": "c12m4_barn",
                "players": [
                    {
                        "name": "Alice",
                        "score": 15,
                        "duration": 1524.47,
                        "duration_formatted": "25分钟"
                    }
                ],
                "addr": "103.28.54.212:27035",
                "basic_info": {
                    "online": true,
                    "name": "Valve Left4Dead 2 Hong Kong Server",
                    "map": "c12m4_barn",
                    "players": {
                        "online": 3,
                        "max": 4
                    },
                    "ping": 793,
                    "game_desc": "Left 4 Dead 2",
                    "version": "2.2.4.3",
                    "server_type": "专用服务器",
                    "environment": "Linux",
                    "vac": 1,
                    "bots": 0,
                    "keywords": "coop,secure"
                },
                "query_time": "2026-05-23 23:02:51"
            }
        }"#
        .to_string()
    }

    fn offline_details_response_json() -> String {
        r#"{
            "success": true,
            "data": {
                "online": false,
                "name": "服务器离线",
                "map": "N/A",
                "players": [],
                "basic_info": {
                    "online": false,
                    "name": "服务器离线",
                    "map": "N/A",
                    "players": {
                        "online": 0,
                        "max": 0
                    },
                    "ping": 0,
                    "game_desc": "N/A",
                    "version": "N/A",
                    "server_type": "N/A",
                    "environment": "N/A",
                    "vac": 0,
                    "bots": 0
                }
            }
        }"#
        .to_string()
    }

    fn empty_list_response_json() -> String {
        r#"{
            "success": true,
            "data": {
                "servers": [],
                "items": [],
                "pagination": {
                    "enabled": false,
                    "pageSize": 50,
                    "totalCount": 0,
                    "totalOnline": 0,
                    "totalPages": 1,
                    "currentPage": 1
                }
            }
        }"#
        .to_string()
    }

    fn sample_params() -> ServerQueryParams {
        ServerQueryParams {
            page: 1,
            page_size: 500,
            filters: crate::models::ServerFilters::default(),
            sort: ServerSort::None,
            addresses: None,
        }
    }

    #[test]
    fn maps_list_response_into_snapshots_with_server_ids() {
        let payload = serde_json::from_str::<ServerListResponse>(&list_response_json()).unwrap();
        let result = map_list_response(&payload, 1, 500).unwrap();

        assert_eq!(result.page, 1);
        assert_eq!(result.page_size, 500);
        assert_eq!(result.total, 247);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].server_id.as_deref(), Some("server854"));
        assert_eq!(result.items[0].address, "103.28.54.212:27035");
        assert_eq!(
            result.items[0].mode_tags,
            vec!["coop".to_string(), "secure".to_string()]
        );
    }

    #[test]
    fn maps_empty_list_response_when_upstream_uses_empty_arrays_for_maps() {
        let payload =
            serde_json::from_str::<ServerListResponse>(&empty_list_response_json()).unwrap();
        let result = map_list_response(&payload, 1, 50).unwrap();

        assert!(result.items.is_empty());
        assert_eq!(result.page, 1);
        assert_eq!(result.page_size, 50);
        assert_eq!(result.total, 0);
    }

    #[test]
    fn maps_detail_response_into_snapshot_and_players() {
        let payload =
            serde_json::from_str::<ServerDetailsResponse>(&details_response_json()).unwrap();
        let result = map_details_response("server854", &payload, None, None).unwrap();

        assert_eq!(result.snapshot.server_id.as_deref(), Some("server854"));
        assert_eq!(result.snapshot.address, "103.28.54.212:27035");
        assert_eq!(result.players.len(), 1);
        assert_eq!(result.players[0].name, "Alice");
        assert_eq!(result.players[0].score, 15);
    }

    #[test]
    fn maps_offline_detail_response_with_fallback_snapshot_address_and_name() {
        let payload =
            serde_json::from_str::<ServerDetailsResponse>(&offline_details_response_json())
                .unwrap();
        let fallback_address = "103.28.54.212:27035";
        let fallback_name = "Valve Left4Dead 2 Hong Kong Server";
        let result = map_details_response(
            "server854",
            &payload,
            Some(fallback_address),
            Some(fallback_name),
        )
        .unwrap();

        assert_eq!(result.snapshot.server_id.as_deref(), Some("server854"));
        assert_eq!(result.snapshot.address, fallback_address);
        assert_eq!(result.snapshot.name, fallback_name);
        assert_eq!(result.snapshot.mode_tags, Vec::<String>::new());
        assert_eq!(result.snapshot.players, 0);
        assert_eq!(result.players.len(), 0);
    }

    #[tokio::test]
    async fn list_request_sends_required_headers_and_fields_without_referer() {
        let request = capture_request(list_response_json(), |client| async move {
            client.query_servers(&sample_params()).await.map(|_| ())
        })
        .await;
        let normalized = request.to_lowercase();

        assert!(normalized.contains("origin: https://zhrradiant.com\r\n"));
        assert!(normalized.contains("user-agent: mozilla/5.0"));
        assert!(!normalized.contains("referer:"));
        assert!(request.contains("name=\"action\"\r\n\r\nl4d2_get_public_servers_page"));
        assert!(request.contains("name=\"show_online\"\r\n\r\n1"));
        assert!(request.contains("name=\"show_official\"\r\n\r\n1"));
        assert!(request.contains("name=\"show_third\"\r\n\r\n1"));
        assert!(request.contains("name=\"nonce\"\r\n\r\nf0a98e670f"));
    }

    #[test]
    fn extracts_public_servers_nonce_from_list_script() {
        let html = r#"
            <script>
            var ajax_object = {"nonce":"theme12345"};
            async fetchPublicServersPage(page, pageSize, filters) {
                const formData = new FormData();
                formData.append('action', 'l4d2_get_public_servers_page');
                formData.append('group', this.groupName);
                formData.append('nonce', '6b2c2bbc80');
            }
            </script>
        "#;

        let nonce = extract_public_servers_nonce(html).unwrap();

        assert_eq!(nonce, "6b2c2bbc80");
    }

    #[test]
    fn ignores_unrelated_theme_nonce_without_list_action() {
        let html = r#"
            <script>
            var ajax_object = {"nonce":"f45a2ae41d"};
            </script>
        "#;

        let error = extract_public_servers_nonce(html)
            .expect_err("theme nonce should not be used for public server requests");

        assert!(matches!(error, AppError::UpstreamUnavailable(_)));
    }

    #[tokio::test]
    async fn address_list_request_sends_address_action_and_json_addresses() {
        let mut params = sample_params();
        params.addresses = Some(vec![
            "1.117.155.157:27015".to_string(),
            "1.15.87.79:30003".to_string(),
            "114.132.67.16:27015".to_string(),
        ]);

        let request = capture_request(list_response_json(), |client| async move {
            client.query_servers(&params).await.map(|_| ())
        })
        .await;

        assert!(request.contains("name=\"action\"\r\n\r\nl4d2_get_public_servers_by_addresses"));
        assert!(request.contains("name=\"addresses\""));
        assert!(
            request.contains(r#"["1.117.155.157:27015","1.15.87.79:30003","114.132.67.16:27015"]"#)
        );
    }

    #[test]
    fn custom_rules_are_serialized_with_priority_and_buckets() {
        let mut params = sample_params();
        params.filters.custom_rules.priority = crate::models::CustomRulePriority::Whitelist;
        params.filters.custom_rules.whitelist.ip = "123.45.67.89:27015".to_string();
        params.filters.custom_rules.blacklist.text = "/萌新|新手/i".to_string();

        let body = serialize_custom_rules(&params.filters.custom_rules);
        let parsed = serde_json::from_str::<serde_json::Value>(&body).unwrap();

        assert_eq!(parsed["priority"], "whitelist");
        assert_eq!(parsed["whitelist"]["ip"], "123.45.67.89:27015");
        assert_eq!(parsed["whitelist"]["text"], "");
        assert_eq!(parsed["blacklist"]["text"], "/萌新|新手/i");
    }

    #[test]
    fn modes_are_serialized_from_selections() {
        assert_eq!(serialize_modes(&[]), "");
        assert_eq!(
            serialize_modes(&["versus".to_string(), "realism".to_string()]),
            "versus,realism"
        );
    }

    #[tokio::test]
    async fn detail_request_sends_required_headers_and_fields_without_referer() {
        let request = capture_request(details_response_json(), |client| async move {
            client
                .get_server_details("server854", None, None)
                .await
                .map(|_| ())
        })
        .await;
        let normalized = request.to_lowercase();

        assert!(normalized.contains("origin: https://zhrradiant.com\r\n"));
        assert!(normalized.contains("user-agent: mozilla/5.0"));
        assert!(!normalized.contains("referer:"));
        assert!(request.contains("name=\"action\"\r\n\r\nget_server_details"));
        assert!(request.contains("name=\"server\"\r\n\r\nserver854"));
        assert!(request.contains("name=\"group\"\r\n\r\npublic"));
    }

    #[test]
    fn proxy_modes_build_http_clients() {
        let timeout = Duration::from_secs(1);
        for mode in [
            crate::models::HttpProxyMode::None,
            crate::models::HttpProxyMode::System,
            crate::models::HttpProxyMode::Custom,
        ] {
            let settings = crate::models::HttpProxySettings {
                mode,
                custom_url: "http://127.0.0.1:7890".to_string(),
            };

            client_builder(timeout, &settings)
                .and_then(|builder| {
                    builder
                        .build()
                        .map_err(|err| AppError::Unexpected(err.to_string()))
                })
                .expect("proxy mode should build a reqwest client");
        }
    }

    #[test]
    fn custom_proxy_mode_rejects_invalid_urls() {
        for custom_url in ["", "socks5://127.0.0.1:1080", "http://"] {
            let settings = crate::models::HttpProxySettings {
                mode: crate::models::HttpProxyMode::Custom,
                custom_url: custom_url.to_string(),
            };

            assert!(matches!(
                client_builder(Duration::from_secs(1), &settings),
                Err(AppError::InvalidSettings(_))
            ));
        }
    }

    #[tokio::test]
    async fn custom_proxy_mode_routes_request_through_proxy() {
        let request = capture_request_with_settings(
            list_response_json(),
            UpstreamApiConfig {
                post_url: "http://example.test/admin-ajax.php".to_string(),
                ..UpstreamApiConfig::default()
            },
            crate::models::HttpProxySettings {
                mode: crate::models::HttpProxyMode::Custom,
                custom_url: String::new(),
            },
            |client| async move { client.query_servers(&sample_params()).await.map(|_| ()) },
        )
        .await;

        assert!(request.starts_with("POST http://example.test/admin-ajax.php "));
        assert!(request.contains("host: example.test") || request.contains("Host: example.test"));
    }

    async fn capture_request<F, Fut>(response_body: String, run_request: F) -> String
    where
        F: FnOnce(HttpUpstreamServerClient) -> Fut,
        Fut: std::future::Future<Output = AppResult<()>>,
    {
        capture_request_with_settings(
            response_body,
            UpstreamApiConfig::default(),
            crate::models::HttpProxySettings {
                mode: crate::models::HttpProxyMode::None,
                custom_url: String::new(),
            },
            run_request,
        )
        .await
    }

    async fn capture_request_with_settings<F, Fut>(
        response_body: String,
        mut config: UpstreamApiConfig,
        mut http_proxy: crate::models::HttpProxySettings,
        run_request: F,
    ) -> String
    where
        F: FnOnce(HttpUpstreamServerClient) -> Fut,
        Fut: std::future::Future<Output = AppResult<()>>,
    {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();

        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];

            loop {
                let read = match stream.read(&mut buffer) {
                    Ok(read) => read,
                    Err(err)
                        if matches!(
                            err.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        if request.is_empty() {
                            continue;
                        }
                        break;
                    }
                    Err(err) => panic!("failed to read request: {err}"),
                };
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
            }

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream.write_all(response.as_bytes()).unwrap();

            String::from_utf8_lossy(&request).to_string()
        });

        if config.post_url == UpstreamApiConfig::default().post_url {
            config.post_url = format!("http://{}", address);
        }
        if http_proxy.mode == crate::models::HttpProxyMode::Custom
            && http_proxy.custom_url.is_empty()
        {
            http_proxy.custom_url = format!("http://{}", address);
        }

        let client = HttpUpstreamServerClient::with_config_and_proxy(
            Duration::from_secs(2),
            config,
            &http_proxy,
        )
        .unwrap();

        run_request(client).await.unwrap();
        server.join().unwrap()
    }
}
