use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use directories::ProjectDirs;
use serde::Serialize;
use tauri::State;

use crate::app_error::{AppError, AppResult};
use crate::backlog::BacklogClient;
use crate::db::Db;
use crate::keychain;
use crate::models::{ExportHistory, IssueDetail, IssueSummary, Project, SetupState};

pub struct AppState {
    pub db_path: PathBuf,
    pub api_key_cache: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> AppResult<Self> {
        let db_path = database_path()?;
        let _ = Db::open(&db_path)?;
        Ok(Self {
            db_path,
            api_key_cache: Mutex::new(None),
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
}

fn database_path() -> AppResult<PathBuf> {
    let dirs = ProjectDirs::from("com", "company", "backlog-markdown-exporter")
        .ok_or_else(|| AppError::Unknown("cannot resolve data dir".to_string()))?;
    Ok(dirs.data_dir().join("app.db"))
}

fn open_db(state: &State<AppState>) -> AppResult<Db> {
    Db::open(Path::new(&state.db_path))
}

fn resolve_api_key(state: &State<AppState>) -> AppResult<String> {
    if let Ok(cache) = state.api_key_cache.lock() {
        if let Some(key) = cache.as_ref() {
            return pick_api_key(Some(key.clone()), None);
        }
    }

    let loaded = keychain::load_api_key()?;
    let key = pick_api_key(None, loaded)?;

    if let Ok(mut cache) = state.api_key_cache.lock() {
        *cache = Some(key.clone());
    }
    Ok(key)
}

fn pick_api_key(cached: Option<String>, loaded: Option<String>) -> AppResult<String> {
    if let Some(key) = cached {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }

    if let Some(key) = loaded {
        if !key.trim().is_empty() {
            return Ok(key);
        }
    }

    Err(AppError::Keychain(
        "API key is not configured in Keychain".to_string(),
    ))
}

fn get_client(state: &State<AppState>) -> AppResult<BacklogClient> {
    let db = open_db(state)?;
    let space_url = db
        .load_space_url()?
        .ok_or_else(|| AppError::Validation("Space URL is not configured".to_string()))?
        .trim()
        .to_string();

    let api_key = resolve_api_key(state)?;

    BacklogClient::new(&space_url, &api_key)
}

fn fetch_detail_online_first(issue_key: &str, state: &State<AppState>) -> AppResult<IssueDetail> {
    let client = get_client(state)?;

    match client.fetch_issue_by_key(issue_key) {
        Ok(detail) => {
            let db = open_db(state)?;
            db.upsert_issue_detail(&detail)?;
            Ok(detail)
        }
        Err(e @ AppError::Network(_)) | Err(e @ AppError::RateLimit) => {
            let db = open_db(state)?;
            db.get_issue_detail_local(issue_key)?.ok_or(e)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn setup_save(space_url: String, api_key: String, state: State<AppState>) -> Result<(), String> {
    run(|| {
        let client = BacklogClient::new(&space_url, &api_key)?;
        client.verify_connection()?;

        keychain::save_api_key(&api_key)?;
        if let Ok(mut cache) = state.api_key_cache.lock() {
            *cache = Some(api_key.trim().to_string());
        }
        let db = open_db(&state)?;
        db.save_space_url(&space_url)?;
        db.save_api_key_configured_marker(true)?;
        Ok(())
    })
}

#[tauri::command]
pub fn setup_load(state: State<AppState>) -> Result<SetupState, String> {
    run(|| {
        let db = open_db(&state)?;
        let space_url = db.load_space_url()?;
        let export_dir = db.load_export_dir()?;
        let configured_marker = db.load_api_key_configured_marker()?;
        let has_api_key = match keychain::load_api_key() {
            Ok(value) => value.is_some() || configured_marker,
            Err(_) => configured_marker,
        };

        Ok(SetupState {
            space_url,
            has_api_key,
            export_dir,
        })
    })
}

#[tauri::command]
pub fn projects_sync(state: State<AppState>) -> Result<Vec<Project>, String> {
    run(|| {
        let client = get_client(&state)?;
        let projects = client.fetch_projects()?;

        let db = open_db(&state)?;
        db.upsert_projects(&projects)?;
        db.list_projects()
    })
}

#[tauri::command]
pub fn issues_search_by_key(issue_key: String, state: State<AppState>) -> Result<Vec<IssueSummary>, String> {
    run(|| {
        let client = get_client(&state)?;
        let key = issue_key.trim();

        match client.fetch_issue_by_key(key) {
            Ok(detail) => {
                let summary = IssueSummary {
                    issue_key: detail.issue_key.clone(),
                    summary: detail.summary.clone(),
                    updated_at: detail.updated_at.clone(),
                };
                let db = open_db(&state)?;
                db.upsert_issue_detail(&detail)?;
                Ok(vec![summary])
            }
            Err(e @ AppError::Network(_)) | Err(e @ AppError::RateLimit) => {
                let db = open_db(&state)?;
                let fallback = db.search_issue_summaries_local(key)?;
                if fallback.is_empty() {
                    Err(e)
                } else {
                    Ok(fallback)
                }
            }
            Err(e) => Err(e),
        }
    })
}

#[tauri::command]
pub fn issues_search_by_keyword(keyword: String, state: State<AppState>) -> Result<Vec<IssueSummary>, String> {
    run(|| {
        let query = keyword.trim();
        if query.is_empty() {
            return Err(AppError::Validation("keyword is required".to_string()));
        }

        let client = get_client(&state)?;
        match client.search_issues_by_keyword(query) {
            Ok(results) => {
                let db = open_db(&state)?;
                for item in &results {
                    db.upsert_issue_summary(item)?;
                }
                Ok(results)
            }
            Err(e @ AppError::Network(_)) | Err(e @ AppError::RateLimit) => {
                let db = open_db(&state)?;
                let fallback = db.search_issue_summaries_local(query)?;
                if fallback.is_empty() {
                    Err(e)
                } else {
                    Ok(fallback)
                }
            }
            Err(e) => Err(e),
        }
    })
}

#[tauri::command]
pub fn issue_get_detail(issue_key: String, state: State<AppState>) -> Result<IssueDetail, String> {
    run(|| {
        let key = issue_key.trim();
        fetch_detail_online_first(key, &state)
    })
}

#[tauri::command]
pub fn issue_export_markdown(
    issue_key: String,
    target_dir: String,
    overwrite: bool,
    state: State<AppState>,
) -> Result<ExportResult, String> {
    run(|| {
        let key = issue_key.trim();
        let detail = fetch_detail_online_first(key, &state)?;

        let target = PathBuf::from(target_dir);
        if !target.exists() {
            fs::create_dir_all(&target)?;
        }

        let path = if overwrite {
            target.join(format!("{key}.md"))
        } else {
            next_available_export_path(&target, key)
        };

        fs::write(&path, detail.description_md)?;

        let db = open_db(&state)?;
        db.insert_export_history(key, &path.to_string_lossy())?;

        Ok(ExportResult {
            path: path.to_string_lossy().to_string(),
        })
    })
}

fn next_available_export_path(target_dir: &Path, issue_key: &str) -> PathBuf {
    let base = target_dir.join(format!("{issue_key}.md"));
    if !base.exists() {
        return base;
    }

    for i in 1..=9_999 {
        let candidate = target_dir.join(format!("{issue_key}({i}).md"));
        if !candidate.exists() {
            return candidate;
        }
    }

    target_dir.join(format!("{issue_key}(overflow).md"))
}

#[tauri::command]
pub fn exports_list(limit: i64, state: State<AppState>) -> Result<Vec<ExportHistory>, String> {
    run(|| {
        let db = open_db(&state)?;
        db.list_exports(limit)
    })
}

#[tauri::command]
pub fn exports_clear(state: State<AppState>) -> Result<(), String> {
    run(|| {
        let db = open_db(&state)?;
        db.clear_exports()
    })
}

#[tauri::command]
pub fn set_export_dir(export_dir: String, state: State<AppState>) -> Result<(), String> {
    run(|| {
        let trimmed = export_dir.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("export directory is required".to_string()));
        }
        let path = PathBuf::from(trimmed);
        if !path.exists() {
            fs::create_dir_all(&path)?;
        }

        let db = open_db(&state)?;
        db.save_export_dir(trimmed)?;
        Ok(())
    })
}

#[tauri::command]
pub fn auth_reset(state: State<AppState>) -> Result<(), String> {
    run(|| {
        keychain::delete_api_key()?;
        if let Ok(mut cache) = state.api_key_cache.lock() {
            *cache = None;
        }

        let db = open_db(&state)?;
        db.clear_api_key_configured_marker()?;
        db.clear_space_url()?;
        db.clear_export_dir()?;
        Ok(())
    })
}

fn run<T>(f: impl FnOnce() -> AppResult<T>) -> Result<T, String> {
    f().map_err(|e| e.to_json())
}

#[cfg(test)]
mod tests {
    use super::pick_api_key;

    #[test]
    fn pick_api_key_prefers_cache() {
        let key = pick_api_key(Some("cached-key".to_string()), Some("loaded-key".to_string()))
            .expect("should select cached key");
        assert_eq!(key, "cached-key");
    }

    #[test]
    fn pick_api_key_uses_loaded_when_cache_missing() {
        let key = pick_api_key(None, Some("loaded-key".to_string()))
            .expect("should select loaded key");
        assert_eq!(key, "loaded-key");
    }

    #[test]
    fn pick_api_key_rejects_empty_values() {
        let err = pick_api_key(Some("   ".to_string()), Some("".to_string()))
            .expect_err("empty values should fail");
        assert!(err.to_string().contains("API key is not configured"));
    }
}
