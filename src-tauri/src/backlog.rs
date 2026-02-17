use std::thread;
use std::time::Duration;

use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde::Deserialize;

use crate::app_error::{AppError, AppResult};
use crate::models::{IssueDetail, IssueSummary, Project};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BacklogProject {
    id: i64,
    project_key: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BacklogIssue {
    issue_key: String,
    summary: String,
    description: Option<String>,
    updated: String,
}

pub struct BacklogClient {
    base_url: String,
    api_key: String,
    client: Client,
}

impl BacklogClient {
    pub fn new(base_url: &str, api_key: &str) -> AppResult<Self> {
        let normalized_base_url = base_url.trim();
        let normalized_api_key = api_key.trim();

        if normalized_base_url.is_empty() {
            return Err(AppError::Validation("space URL is required".to_string()));
        }
        if normalized_api_key.is_empty() {
            return Err(AppError::Validation("API key is required".to_string()));
        }

        Ok(Self {
            base_url: normalized_base_url.trim_end_matches('/').to_string(),
            api_key: normalized_api_key.to_string(),
            client: Client::builder()
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(20))
                .build()?,
        })
    }

    pub fn verify_connection(&self) -> AppResult<()> {
        let url = self.url_with_key("/api/v2/users/myself");
        let response = self.client.get(url).send()?;
        map_status(response).map(|_| ())
    }

    pub fn fetch_projects(&self) -> AppResult<Vec<Project>> {
        let url = self.url_with_key("/api/v2/projects");
        let response = self.get_with_retry(&url)?;
        let payload: Vec<BacklogProject> = response.json().map_err(AppError::from)?;

        let now = chrono::Utc::now().to_rfc3339();
        Ok(payload
            .into_iter()
            .map(|p| Project {
                id: p.id,
                project_key: p.project_key,
                name: p.name,
                synced_at: now.clone(),
            })
            .collect())
    }

    pub fn fetch_issue_by_key(&self, issue_key: &str) -> AppResult<IssueDetail> {
        let path = format!("/api/v2/issues/{issue_key}");
        let url = self.url_with_key(&path);
        let response = self.get_with_retry(&url)?;
        let issue: BacklogIssue = response.json().map_err(AppError::from)?;

        Ok(self.to_detail(issue))
    }

    pub fn search_issues_by_keyword(&self, keyword: &str) -> AppResult<Vec<IssueSummary>> {
        let path = format!(
            "/api/v2/issues?keyword={}",
            urlencoding::encode(keyword.trim())
        );
        let url = self.url_with_key(&path);
        let response = self.get_with_retry(&url)?;
        let items: Vec<BacklogIssue> = response.json().map_err(AppError::from)?;
        Ok(items
            .into_iter()
            .map(|issue| IssueSummary {
                issue_key: issue.issue_key,
                summary: issue.summary,
                updated_at: issue.updated,
            })
            .collect())
    }

    fn to_detail(&self, issue: BacklogIssue) -> IssueDetail {
        let raw = issue.description.unwrap_or_default();
        let md = crate::markdown::backlog_to_markdown(&raw);
        IssueDetail {
            issue_key: issue.issue_key,
            summary: issue.summary,
            description_raw: raw,
            description_md: md,
            updated_at: issue.updated,
            synced_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    fn url_with_key(&self, path: &str) -> String {
        let connector = if path.contains('?') { '&' } else { '?' };
        let encoded_key = urlencoding::encode(&self.api_key);
        format!("{}{}{}apiKey={}", self.base_url, path, connector, encoded_key)
    }

    fn get_with_retry(&self, url: &str) -> AppResult<Response> {
        let mut wait = 1;
        let max_attempts = 3;

        for attempt in 1..=max_attempts {
            let resp = self.client.get(url).send();
            match resp {
                Ok(r) => {
                    if r.status() == StatusCode::TOO_MANY_REQUESTS && attempt < max_attempts {
                        thread::sleep(Duration::from_secs(wait));
                        wait *= 2;
                        continue;
                    }
                    return map_status(r);
                }
                Err(e) => {
                    if (e.is_timeout() || e.is_connect()) && attempt < max_attempts {
                        thread::sleep(Duration::from_secs(wait));
                        wait *= 2;
                        continue;
                    }
                    return Err(e.into());
                }
            }
        }

        Err(AppError::Unknown("retry loop exhausted".to_string()))
    }
}

fn map_status(response: Response) -> AppResult<Response> {
    match map_status_code(response.status()) {
        Ok(()) => Ok(response),
        Err(e) => Err(e),
    }
}

fn map_status_code(status: StatusCode) -> AppResult<()> {
    match status {
        StatusCode::OK => Ok(()),
        StatusCode::UNAUTHORIZED => Err(AppError::AuthInvalid),
        StatusCode::FORBIDDEN => Err(AppError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => Err(AppError::RateLimit),
        StatusCode::NOT_FOUND => Err(AppError::NotFound),
        s if s.is_server_error() => Err(AppError::Network(format!("server error: {s}"))),
        s => Err(AppError::Unknown(format!("unexpected status: {s}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::map_status_code;
    use reqwest::StatusCode;

    #[test]
    fn status_mapping_works() {
        let err = map_status_code(StatusCode::TOO_MANY_REQUESTS).expect_err("should map to error");
        assert!(matches!(err, crate::app_error::AppError::RateLimit));
    }

    #[test]
    fn status_401_maps_to_auth_invalid() {
        let err = map_status_code(StatusCode::UNAUTHORIZED).expect_err("should map to error");
        assert!(matches!(err, crate::app_error::AppError::AuthInvalid));
    }

    #[test]
    fn status_403_maps_to_forbidden() {
        let err = map_status_code(StatusCode::FORBIDDEN).expect_err("should map to error");
        assert!(matches!(err, crate::app_error::AppError::Forbidden));
    }
}
