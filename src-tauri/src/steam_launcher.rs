use crate::errors::{AppError, AppResult};
use crate::models::ServerAddress;

pub fn build_steam_connect_url(address: &str) -> AppResult<String> {
    let trimmed_address = address.trim();
    let (host, port) = trimmed_address
        .rsplit_once(':')
        .ok_or_else(|| AppError::InvalidAddress(address.to_string()))?;

    validate_host(host, address)?;

    if port.is_empty() || !port.chars().all(|value| value.is_ascii_digit()) {
        return Err(AppError::InvalidAddress(address.to_string()));
    }

    let parsed_port = port
        .parse::<u16>()
        .map_err(|_| AppError::InvalidAddress(address.to_string()))?;

    if parsed_port == 0 {
        return Err(AppError::InvalidAddress(address.to_string()));
    }

    Ok(format!("steam://connect/{}:{}", host, parsed_port))
}

pub fn parse_server_address(address: &str) -> AppResult<ServerAddress> {
    let url = build_steam_connect_url(address)?;
    let canonical = url
        .strip_prefix("steam://connect/")
        .ok_or_else(|| AppError::InvalidAddress(address.to_string()))?;
    let (host, port) = canonical
        .rsplit_once(':')
        .ok_or_else(|| AppError::InvalidAddress(address.to_string()))?;
    let port = port
        .parse::<u16>()
        .map_err(|_| AppError::InvalidAddress(address.to_string()))?;

    Ok(ServerAddress {
        ip: host.to_string(),
        port,
    })
}

pub fn launch(address: &str) -> AppResult<()> {
    let _url = build_steam_connect_url(address)?;
    log::info!("validated Steam launch address '{}'", address.trim());
    // tauri_plugin_opener::open_url(url, None::<&str>)
    //     .map_err(|err| AppError::LaunchFailed(err.to_string()));
    Ok(())
}

fn validate_host(host: &str, original_address: &str) -> AppResult<()> {
    if host.trim().is_empty() || host != host.trim() {
        return Err(AppError::InvalidAddress(original_address.to_string()));
    }

    if host.contains("://") {
        return Err(AppError::InvalidAddress(original_address.to_string()));
    }

    if host.chars().any(is_unsafe_host_char) {
        return Err(AppError::InvalidAddress(original_address.to_string()));
    }

    let labels: Vec<_> = host.split('.').collect();
    if labels.len() == 4
        && labels
            .iter()
            .all(|label| label.chars().all(|value| value.is_ascii_digit()))
    {
        for label in &labels {
            label
                .parse::<u8>()
                .map_err(|_| AppError::InvalidAddress(original_address.to_string()))?;
        }
    }

    for label in labels {
        if label.is_empty() || label.starts_with('-') || label.ends_with('-') {
            return Err(AppError::InvalidAddress(original_address.to_string()));
        }
    }

    Ok(())
}

fn is_unsafe_host_char(value: char) -> bool {
    value.is_control()
        || value.is_whitespace()
        || !matches!(value, 'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_steam_connect_url_for_valid_address() {
        let url = build_steam_connect_url("1.2.3.4:27015").unwrap();
        assert_eq!(url, "steam://connect/1.2.3.4:27015");
    }

    #[test]
    fn trims_address_before_building_url() {
        let url = build_steam_connect_url("  l4d2.example.com:27016  ").unwrap();
        assert_eq!(url, "steam://connect/l4d2.example.com:27016");
    }

    #[test]
    fn parses_address_into_host_and_port() {
        let parsed = parse_server_address("  l4d2.example.com:27016  ").unwrap();

        assert_eq!(parsed.ip, "l4d2.example.com");
        assert_eq!(parsed.port, 27016);
    }

    #[test]
    fn rejects_address_without_port() {
        let err = build_steam_connect_url("1.2.3.4").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_empty_host() {
        let err = build_steam_connect_url(":27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_blank_port() {
        let err = build_steam_connect_url("1.2.3.4:").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_port_with_leading_plus_sign() {
        let err = build_steam_connect_url("1.2.3.4:+27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_out_of_range_port() {
        let err = build_steam_connect_url("1.2.3.4:70000").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_zero_port() {
        let err = build_steam_connect_url("1.2.3.4:0").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_ipv4_host_with_out_of_range_octet() {
        let err = build_steam_connect_url("256.1.2.3:27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_ipv4_host_with_all_out_of_range_octets() {
        let err = build_steam_connect_url("999.999.999.999:27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_internal_whitespace() {
        let err = build_steam_connect_url("l4d2 server:27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_url_like_addresses() {
        let err = build_steam_connect_url("https://1.2.3.4:27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_path_like_addresses() {
        let err = build_steam_connect_url("1.2.3.4/path:27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_addresses_with_extra_colons() {
        let err = build_steam_connect_url("1.2.3.4:27015:27016").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_query_and_fragment_characters() {
        let query_err = build_steam_connect_url("1.2.3.4?x=1:27015").unwrap_err();
        let fragment_err = build_steam_connect_url("1.2.3.4#frag:27015").unwrap_err();

        assert!(query_err.to_string().contains("Invalid address"));
        assert!(fragment_err.to_string().contains("Invalid address"));
    }

    #[test]
    fn rejects_control_characters() {
        let err = build_steam_connect_url("1.2.3.4\u{7}:27015").unwrap_err();
        assert!(err.to_string().contains("Invalid address"));
    }
}
