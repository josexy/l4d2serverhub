use chrono::{DateTime, Utc};
use serde::de::{DeserializeOwned, Error as DeError};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServersPageResponse<T> {
    pub data: T,
    pub success: bool,
}

pub type ServerListResponse = ServersPageResponse<ServerListData>;
pub type ServerDetailsResponse = ServersPageResponse<ServerDetailsData>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicServersPageRequest {
    // 默认值 l4d2_get_public_servers_page
    pub action: String,
    // 自定义筛选规则
    pub custom_rules: String,
    // 组: 默认值 public
    pub group: String,
    // 是否包含玩家信息: 默认值 0
    pub include_players: i64,
    // 地图过滤列表: 默认值 [], 逗号分隔的地图列表，比如 ["死亡中心"]
    pub maps: String,
    // 服务器模式: 默认值 "" 表示包含所有模式
    // 逗号分隔的模式列表, 例如 "versus,realism,coop,survival,scavenge,unknown"
    // 分别表示 对抗、写实、战役、生存、清道夫和未知
    pub modes: String,
    // 查询随机服务器: 默认值 f0a98e670f
    pub nonce: String,
    // 页码: 默认值 1
    pub page: i64,
    // 每页大小: 默认值 50
    pub page_size: i64,
    // 查询关键词: 默认值 ""
    pub query: String,
    // 查询空服务器: 默认值 0
    pub show_empty: i64,
    // 显示官方服务器: 默认值 0
    pub show_official: i64,
    // 显示在线服务器: 默认值 0
    pub show_online: i64,
    // 显示第三方服务器: 默认值 0
    pub show_third: i64,
    // 排序方式: 默认值 "none", players_desc: 玩家数降序(人多在前), players_asc: 玩家数升序(人少在前)
    pub sort: String,
    pub addresses: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerListData {
    #[serde(deserialize_with = "deserialize_empty_array_as_empty_hash_map")]
    pub items: HashMap<String, ServerInfoItem>,
    pub pagination: Pagination,
    // 服务器列表, 比如 server4: "1.116.117.145:27004"
    // key 是服务器id，value 是服务器地址
    #[serde(deserialize_with = "deserialize_empty_array_as_empty_hash_map")]
    pub servers: HashMap<String, String>,
}

fn deserialize_empty_array_as_empty_hash_map<'de, D, V>(
    deserializer: D,
) -> Result<HashMap<String, V>, D::Error>
where
    D: Deserializer<'de>,
    V: DeserializeOwned,
{
    let value = serde_json::Value::deserialize(deserializer)?;

    match value {
        serde_json::Value::Object(object) => object
            .into_iter()
            .map(|(key, value)| {
                serde_json::from_value(value)
                    .map(|mapped| (key, mapped))
                    .map_err(D::Error::custom)
            })
            .collect(),
        serde_json::Value::Array(items) if items.is_empty() => Ok(HashMap::new()),
        _ => Err(D::Error::custom(
            "expected object or empty array for upstream map field",
        )),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfoItem {
    // 服务器地址, 例如 "1.116.117.145:27001"
    pub addr: String,
    // 人机数量
    pub bots: i64,
    // 服务器操作系统, 例如 Linux
    pub environment: String,
    // 服务器描述, 例如 "Left 4 Dead 2"
    pub game_desc: String,
    // 服务器关键词, 逗号分隔的关键词列表，例如 "coop,!buy,0,secure"
    pub keywords: String,
    // 服务器地图, 例如 "c12m1_hilltop"
    pub map: String,
    // 服务器名称
    pub name: String,
    // 是否在线
    pub online: bool,
    // 服务器延迟，单位毫秒
    pub ping: i64,
    // 玩家列表，查询服务器列表时一般为空，需要单独查询服务器详情才能获取玩家信息
    #[serde(rename = "playerList")]
    pub player_list: Vec<String>,
    // 玩家数量和最大玩家数量
    pub players: Players,
    // 服务器类型, 例如 "专用服务器"
    pub server_type: String,
    // 是否受VAC保护
    pub vac: i64,
    // 服务器版本, 例如 "2.2.4.3"
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Players {
    // 最大玩家数量
    pub max: i64,
    // 在线人数
    pub online: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    // 当前页码，从1开始
    pub current_page: i64,
    // 是否启用
    pub enabled: bool,
    // 每页大小
    pub page_size: i64,
    // 总在服人数
    pub total_count: i64,
    // 总在线人数
    pub total_online: i64,
    // 总页数
    pub total_pages: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDetailsRequest {
    // 默认 get_server_details
    pub action: String,
    // 分组，默认 public
    pub group: String,
    // 随机数，默认 f0a98e670f
    pub nonce: String,
    // 服务器id，比如 server4
    pub server: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDetailsData {
    // 服务器地址
    #[serde(default)]
    pub addr: String,
    // 服务器基本信息
    pub basic_info: BasicInfo,
    // 服务器地图, 例如 "c12m1_hilltop"
    pub map: String,
    // 服务器名称
    pub name: String,
    // 是否在线
    pub online: bool,
    // 玩家列表
    pub players: Vec<Player>,
    // 查询时间
    #[serde(default)]
    pub query_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasicInfo {
    // 人机数量
    pub bots: i64,
    // 服务器操作系统, 例如 Linux
    pub environment: String,
    // 服务器描述, 例如 "Left 4 Dead 2"
    pub game_desc: String,
    // 服务器关键词, 逗号分隔的关键词列表，例如 "coop,!buy,0,secure"
    #[serde(default)]
    pub keywords: String,
    // 服务器地图, 例如 "c12m1_hilltop"
    pub map: String,
    // 服务器名称
    pub name: String,
    // 是否在线
    pub online: bool,
    // 服务器延迟，单位毫秒
    pub ping: i64,
    // 玩家数量和最大玩家数量
    pub players: Players,
    // 服务器类型, 例如 "专用服务器"
    pub server_type: String,
    // 是否受VAC保护
    pub vac: i64,
    // 服务器版本, 例如 "2.2.4.3"
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    // 在服时间，单位秒, 例如 6981.5966796875
    pub duration: f64,
    // 在服时间，格式化后的字符串，例如 "116分钟"
    pub duration_formatted: String,
    // 玩家名称
    pub name: String,
    // 玩家分数
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerAddress {
    pub ip: String,
    pub port: u16,
}

impl ServerAddress {
    pub fn as_string(&self) -> String {
        format!("{}:{}", self.ip, self.port)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "ServerSnapshotUnchecked")]
pub struct ServerSnapshot {
    pub server_id: Option<String>,
    pub address: String,
    pub ip: String,
    pub port: u16,
    pub name: String,
    pub map: String,
    pub mode_tags: Vec<String>,
    pub game_description: Option<String>,
    pub server_type: Option<String>,
    pub environment: Option<String>,
    pub version: Option<String>,
    pub players: u32,
    pub max_players: u32,
    pub bots: u32,
    pub ping_ms: Option<u32>,
    pub vac_secured: bool,
    pub last_seen_at: DateTime<Utc>,
    pub last_query_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ServerSnapshotInput {
    pub server_id: Option<String>,
    pub address: String,
    pub ip: String,
    pub port: u16,
    pub name: String,
    pub map: String,
    pub mode_tags: Vec<String>,
    pub game_description: Option<String>,
    pub server_type: Option<String>,
    pub environment: Option<String>,
    pub version: Option<String>,
    pub players: u32,
    pub max_players: u32,
    pub bots: u32,
    pub ping_ms: Option<u32>,
    pub vac_secured: bool,
    pub last_seen_at: DateTime<Utc>,
    pub last_query_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ServerSnapshotUnchecked {
    #[serde(deserialize_with = "deserialize_required_option")]
    server_id: Option<String>,
    address: String,
    ip: String,
    port: u16,
    name: String,
    map: String,
    mode_tags: Vec<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    game_description: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    server_type: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    environment: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    version: Option<String>,
    players: u32,
    max_players: u32,
    bots: u32,
    #[serde(deserialize_with = "deserialize_required_option")]
    ping_ms: Option<u32>,
    vac_secured: bool,
    last_seen_at: DateTime<Utc>,
    #[serde(deserialize_with = "deserialize_required_option")]
    last_query_error: Option<String>,
}

impl ServerSnapshot {
    pub fn try_new(input: ServerSnapshotInput) -> Result<Self, String> {
        let snapshot = Self {
            server_id: input.server_id,
            address: input.address,
            ip: input.ip,
            port: input.port,
            name: input.name,
            map: input.map,
            mode_tags: input.mode_tags,
            game_description: input.game_description,
            server_type: input.server_type,
            environment: input.environment,
            version: input.version,
            players: input.players,
            max_players: input.max_players,
            bots: input.bots,
            ping_ms: input.ping_ms,
            vac_secured: input.vac_secured,
            last_seen_at: input.last_seen_at,
            last_query_error: input.last_query_error,
        };

        snapshot.validate_address_consistency()?;

        Ok(snapshot)
    }

    pub fn address_parts(&self) -> ServerAddress {
        ServerAddress {
            ip: self.ip.clone(),
            port: self.port,
        }
    }

    pub fn canonical_address(&self) -> String {
        self.address_parts().as_string()
    }

    pub fn validate_address_consistency(&self) -> Result<(), String> {
        let canonical = self.canonical_address();
        if self.address == canonical {
            Ok(())
        } else {
            Err(format!(
                "snapshot address '{}' does not match canonical address '{}'",
                self.address, canonical
            ))
        }
    }
}

impl TryFrom<ServerSnapshotUnchecked> for ServerSnapshot {
    type Error = String;

    fn try_from(value: ServerSnapshotUnchecked) -> Result<Self, Self::Error> {
        Self::try_new(ServerSnapshotInput {
            server_id: value.server_id,
            address: value.address,
            ip: value.ip,
            port: value.port,
            name: value.name,
            map: value.map,
            mode_tags: value.mode_tags,
            game_description: value.game_description,
            server_type: value.server_type,
            environment: value.environment,
            version: value.version,
            players: value.players,
            max_players: value.max_players,
            bots: value.bots,
            ping_ms: value.ping_ms,
            vac_secured: value.vac_secured,
            last_seen_at: value.last_seen_at,
            last_query_error: value.last_query_error,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPlayer {
    pub name: String,
    pub score: i32,
    pub duration_sec: f32,
    pub duration_formatted: String,
}

pub fn format_player_duration(seconds: f64) -> String {
    let total_seconds = if seconds.is_finite() && seconds > 0.0 {
        seconds.floor() as u64
    } else {
        0
    };
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let mut formatted = String::new();

    if hours > 0 {
        formatted.push_str(&format!("{hours}h"));
    }
    if minutes > 0 {
        formatted.push_str(&format!("{minutes}m"));
    }
    if seconds > 0 || formatted.is_empty() {
        formatted.push_str(&format!("{seconds}s"));
    }

    formatted
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDetails {
    pub snapshot: ServerSnapshot,
    pub players: Vec<ServerPlayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub address: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub server_id: Option<String>,
    pub group_id: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub custom_name: Option<String>,
    pub notes: String,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub last_connected_at: Option<DateTime<Utc>>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub last_snapshot: Option<ServerSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FavoriteInput {
    pub address: String,
    #[serde(default)]
    pub server_id: Option<String>,
    pub group_id: String,
    pub custom_name: Option<String>,
    pub notes: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteGroup {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    pub address: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub server_id: Option<String>,
    pub server_name: String,
    pub map: String,
    pub players: u32,
    pub max_players: u32,
    pub connected_at: DateTime<Utc>,
    #[serde(default = "default_connection_count")]
    pub connection_count: u32,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub last_snapshot: Option<ServerSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHistoryRecord {
    pub id: String,
    pub query: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_query_timeout_ms")]
    pub query_timeout_ms: u64,
    #[serde(default)]
    pub server_details_query_mode: ServerDetailsQueryMode,
    #[serde(default)]
    pub theme: ThemePreference,
    #[serde(default)]
    pub language: LanguagePreference,
    #[serde(default)]
    pub http_proxy: HttpProxySettings,
    #[serde(default)]
    pub server_browser: ServerBrowserSettings,
    #[serde(default)]
    pub logging: LoggingSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            query_timeout_ms: default_query_timeout_ms(),
            server_details_query_mode: ServerDetailsQueryMode::default(),
            theme: ThemePreference::default(),
            language: LanguagePreference::default(),
            http_proxy: HttpProxySettings::default(),
            server_browser: ServerBrowserSettings::default(),
            logging: LoggingSettings::default(),
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> Result<(), String> {
        self.http_proxy.validate()
    }
}

fn default_query_timeout_ms() -> u64 {
    10000
}

fn default_connection_count() -> u32 {
    1
}

fn default_default_page_size() -> usize {
    50
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServerDetailsQueryMode {
    #[default]
    A2sUdp,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerBrowserSettings {
    #[serde(default)]
    pub filters: ServerFilters,
    #[serde(default)]
    pub sort: ServerSort,
    #[serde(default = "default_default_page_size")]
    pub page_size: usize,
}

impl Default for ServerBrowserSettings {
    fn default() -> Self {
        Self {
            filters: ServerFilters::default(),
            sort: ServerSort::default(),
            page_size: default_default_page_size(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    System,
    Light,
    #[default]
    Dark,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LanguagePreference {
    #[default]
    System,
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpProxySettings {
    #[serde(default)]
    pub mode: HttpProxyMode,
    #[serde(default)]
    pub custom_url: String,
}

impl HttpProxySettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.mode != HttpProxyMode::Custom {
            return Ok(());
        }

        let custom_url = self.custom_url.trim();
        if custom_url.is_empty() {
            return Err("custom proxy URL is required when proxy mode is custom".to_string());
        }

        let parsed = url::Url::parse(custom_url)
            .map_err(|err| format!("custom proxy URL is invalid: {err}"))?;
        match parsed.scheme() {
            "http" | "https" => {}
            scheme => {
                return Err(format!(
                    "custom proxy URL scheme '{}' is unsupported; use http or https",
                    scheme
                ));
            }
        }

        if parsed.host().is_none() {
            return Err("custom proxy URL must include a host".to_string());
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HttpProxyMode {
    None,
    #[default]
    System,
    Custom,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoggingSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub level: LogLevel,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    #[default]
    Info,
    Debug,
    Trace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerQueryParams {
    pub page: usize,
    pub page_size: usize,
    pub filters: ServerFilters,
    pub sort: ServerSort,
    #[serde(default)]
    pub addresses: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerFilters {
    #[serde(default)]
    pub query: String,
    #[serde(default = "default_show_online")]
    pub show_online: bool,
    #[serde(default = "default_show_empty")]
    pub show_empty: bool,
    #[serde(default = "default_show_official")]
    pub show_official: bool,
    #[serde(default = "default_show_third")]
    pub show_third: bool,
    #[serde(default = "default_mode_selections")]
    pub mode_selections: Vec<String>,
    #[serde(default)]
    pub custom_rules: ServerCustomRules,
}

impl Default for ServerFilters {
    fn default() -> Self {
        Self {
            query: String::new(),
            show_online: default_show_online(),
            show_empty: default_show_empty(),
            show_official: default_show_official(),
            show_third: default_show_third(),
            mode_selections: default_mode_selections(),
            custom_rules: ServerCustomRules::default(),
        }
    }
}

fn default_show_online() -> bool {
    true
}

fn default_show_empty() -> bool {
    true
}

fn default_show_official() -> bool {
    true
}

fn default_show_third() -> bool {
    true
}

fn default_mode_selections() -> Vec<String> {
    vec![
        "versus".to_string(),
        "realism".to_string(),
        "coop".to_string(),
        "survival".to_string(),
        "scavenge".to_string(),
        "unknown".to_string(),
    ]
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CustomRulePriority {
    Whitelist,
    #[default]
    Blacklist,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomRuleBlock {
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerCustomRules {
    #[serde(default)]
    pub priority: CustomRulePriority,
    #[serde(default)]
    pub whitelist: CustomRuleBlock,
    #[serde(default)]
    pub blacklist: CustomRuleBlock,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServerSort {
    #[serde(rename = "none")]
    #[default]
    None,
    PlayersDesc,
    PlayersAsc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerQueryResult {
    pub items: Vec<ServerSnapshot>,
    pub page: usize,
    pub page_size: usize,
    pub total: usize,
    pub refreshed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedServerSnapshotQueryParams {
    pub targets: Vec<SavedServerSnapshotQueryTarget>,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedServerSnapshotQueryTarget {
    pub address: String,
    #[serde(default)]
    pub server_id: Option<String>,
    #[serde(default)]
    pub fallback_name: Option<String>,
    #[serde(default)]
    pub fallback_snapshot: Option<ServerSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedServerSnapshotQueryResult {
    pub page_result: ServerQueryResult,
    pub snapshots: Vec<ServerSnapshot>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn sample_snapshot() -> ServerSnapshot {
        ServerSnapshot {
            server_id: Some("server-test".to_string()),
            address: "127.0.0.1:27015".to_string(),
            ip: "127.0.0.1".to_string(),
            port: 27015,
            name: "Test Server".to_string(),
            map: "c1m1_hotel".to_string(),
            mode_tags: vec!["coop".to_string()],
            game_description: Some("Left 4 Dead 2".to_string()),
            server_type: Some("Dedicated".to_string()),
            environment: Some("Linux".to_string()),
            version: Some("2.2.4.3".to_string()),
            players: 4,
            max_players: 8,
            bots: 0,
            ping_ms: Some(42),
            vac_secured: true,
            last_seen_at: Utc::now(),
            last_query_error: None,
        }
    }

    fn sample_snapshot_json() -> Value {
        json!({
            "serverId": "server-test",
            "address": "127.0.0.1:27015",
            "ip": "127.0.0.1",
            "port": 27015,
            "name": "Test Server",
            "map": "c1m1_hotel",
            "modeTags": ["coop"],
            "gameDescription": "Left 4 Dead 2",
            "serverType": "Dedicated",
            "environment": "Linux",
            "version": "2.2.4.3",
            "players": 4,
            "maxPlayers": 8,
            "bots": 0,
            "pingMs": 42,
            "vacSecured": true,
            "lastSeenAt": Utc::now(),
            "lastQueryError": null,
        })
    }

    #[test]
    fn formats_player_duration_with_compact_units() {
        assert_eq!(format_player_duration(9030.9), "2h30m30s");
        assert_eq!(format_player_duration(1800.0), "30m");
        assert_eq!(format_player_duration(10.0), "10s");
        assert_eq!(format_player_duration(3600.0), "1h");
        assert_eq!(format_player_duration(0.0), "0s");
        assert_eq!(format_player_duration(-12.0), "0s");
        assert_eq!(format_player_duration(f64::NAN), "0s");
    }

    #[test]
    fn validate_address_consistency_accepts_matching_address() {
        let snapshot = sample_snapshot();

        assert!(snapshot.validate_address_consistency().is_ok());
    }

    #[test]
    fn validate_address_consistency_rejects_divergent_address() {
        let mut snapshot = sample_snapshot();
        snapshot.address = "10.0.0.1:12345".to_string();

        let error = snapshot
            .validate_address_consistency()
            .expect_err("address mismatch should be rejected");

        assert!(error.contains("10.0.0.1:12345"));
        assert!(error.contains("127.0.0.1:27015"));
    }

    #[test]
    fn deserialize_server_snapshot_accepts_matching_address() {
        let value = sample_snapshot_json();

        let snapshot = serde_json::from_value::<ServerSnapshot>(value)
            .expect("matching address should deserialize");

        assert_eq!(snapshot.address, "127.0.0.1:27015");
        assert_eq!(snapshot.canonical_address(), "127.0.0.1:27015");
    }

    #[test]
    fn deserialize_server_snapshot_rejects_divergent_address() {
        let mut value = sample_snapshot_json();
        value["address"] = json!("10.0.0.1:12345");

        let error = serde_json::from_value::<ServerSnapshot>(value)
            .expect_err("address mismatch should fail deserialization");
        let message = error.to_string();

        assert!(message.contains("10.0.0.1:12345"));
        assert!(message.contains("127.0.0.1:27015"));
    }

    #[test]
    fn default_settings_disable_logging_at_info_level() {
        let settings = AppSettings::default();

        assert!(!settings.logging.enabled);
        assert!(matches!(settings.logging.level, LogLevel::Info));
    }

    #[test]
    fn settings_serialize_logging_with_camel_case_fields_and_lowercase_level() {
        let mut settings = AppSettings::default();
        settings.logging.enabled = true;
        settings.logging.level = LogLevel::Debug;

        let value = serde_json::to_value(settings).unwrap();

        assert_eq!(value["logging"]["enabled"], json!(true));
        assert_eq!(value["logging"]["level"], json!("debug"));
    }

    #[test]
    fn settings_deserialization_rejects_invalid_logging_level() {
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value["logging"]["level"] = json!("verbose");

        let error = serde_json::from_value::<AppSettings>(value)
            .expect_err("invalid logging level should fail");

        assert!(error.to_string().contains("verbose"));
    }
}
