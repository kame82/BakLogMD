use std::fs;
use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::app_error::{AppError, AppResult};
use crate::models::{ExportHistory, IssueDetail, IssueSummary, Project};

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                project_key TEXT NOT NULL,
                name TEXT NOT NULL,
                synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS issues (
                issue_key TEXT PRIMARY KEY,
                summary TEXT NOT NULL,
                description_raw TEXT,
                description_md TEXT,
                updated_at TEXT NOT NULL,
                synced_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS exports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issue_key TEXT NOT NULL,
                export_path TEXT NOT NULL,
                exported_at TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    pub fn save_space_url(&self, space_url: &str) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO app_settings(key, value) VALUES('space_url', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![space_url],
        )?;
        Ok(())
    }

    pub fn save_api_key_configured_marker(&self, configured: bool) -> AppResult<()> {
        let value = if configured { "1" } else { "0" };
        self.conn.execute(
            "INSERT INTO app_settings(key, value) VALUES('api_key_configured', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![value],
        )?;
        Ok(())
    }

    pub fn load_api_key_configured_marker(&self) -> AppResult<bool> {
        let value = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'api_key_configured'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        Ok(matches!(value.as_deref(), Some("1" | "true" | "yes")))
    }

    pub fn clear_api_key_configured_marker(&self) -> AppResult<()> {
        self.conn.execute(
            "DELETE FROM app_settings WHERE key = 'api_key_configured'",
            [],
        )?;
        Ok(())
    }

    pub fn load_space_url(&self) -> AppResult<Option<String>> {
        let value = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'space_url'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value)
    }

    pub fn clear_space_url(&self) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM app_settings WHERE key = 'space_url'", [])?;
        Ok(())
    }

    pub fn save_export_dir(&self, export_dir: &str) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO app_settings(key, value) VALUES('export_dir', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![export_dir],
        )?;
        Ok(())
    }

    pub fn load_export_dir(&self) -> AppResult<Option<String>> {
        let value = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'export_dir'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value)
    }

    pub fn clear_export_dir(&self) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM app_settings WHERE key = 'export_dir'", [])?;
        Ok(())
    }

    pub fn upsert_projects(&self, projects: &[Project]) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let mut stmt = self.conn.prepare(
            "INSERT INTO projects(id, project_key, name, synced_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                 project_key = excluded.project_key,
                 name = excluded.name,
                 synced_at = excluded.synced_at",
        )?;

        for p in projects {
            stmt.execute(params![p.id, p.project_key, p.name, now])?;
        }
        Ok(())
    }

    pub fn list_projects(&self) -> AppResult<Vec<Project>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_key, name, synced_at FROM projects ORDER BY project_key ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                project_key: row.get(1)?,
                name: row.get(2)?,
                synced_at: row.get(3)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn upsert_issue_detail(&self, detail: &IssueDetail) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO issues(issue_key, summary, description_raw, description_md, updated_at, synced_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(issue_key) DO UPDATE SET
                summary = excluded.summary,
                description_raw = excluded.description_raw,
                description_md = excluded.description_md,
                updated_at = excluded.updated_at,
                synced_at = excluded.synced_at",
            params![
                detail.issue_key,
                detail.summary,
                detail.description_raw,
                detail.description_md,
                detail.updated_at,
                now
            ],
        )?;
        Ok(())
    }

    pub fn upsert_issue_summary(&self, summary: &IssueSummary) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO issues(issue_key, summary, updated_at, synced_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(issue_key) DO UPDATE SET
                summary = excluded.summary,
                updated_at = excluded.updated_at,
                synced_at = excluded.synced_at",
            params![summary.issue_key, summary.summary, summary.updated_at, now],
        )?;
        Ok(())
    }

    pub fn search_issue_summaries_local(&self, keyword: &str) -> AppResult<Vec<IssueSummary>> {
        let like = format!("%{}%", keyword);
        let mut stmt = self.conn.prepare(
            "SELECT issue_key, summary, updated_at
             FROM issues
             WHERE issue_key LIKE ?1 OR summary LIKE ?1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![like], |row| {
            Ok(IssueSummary {
                issue_key: row.get(0)?,
                summary: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_issue_detail_local(&self, issue_key: &str) -> AppResult<Option<IssueDetail>> {
        let detail = self
            .conn
            .query_row(
                "SELECT issue_key, summary, COALESCE(description_raw, ''), COALESCE(description_md, ''), updated_at, synced_at
                 FROM issues WHERE issue_key = ?1",
                params![issue_key],
                |row| {
                    Ok(IssueDetail {
                        issue_key: row.get(0)?,
                        summary: row.get(1)?,
                        description_raw: row.get(2)?,
                        description_md: row.get(3)?,
                        updated_at: row.get(4)?,
                        synced_at: row.get(5)?,
                    })
                },
            )
            .optional()?;
        Ok(detail)
    }

    pub fn insert_export_history(&self, issue_key: &str, export_path: &str) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO exports(issue_key, export_path, exported_at)
             VALUES(?1, ?2, ?3)",
            params![issue_key, export_path, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn list_exports(&self, limit: i64) -> AppResult<Vec<ExportHistory>> {
        if limit <= 0 {
            return Err(AppError::Validation("limit must be > 0".to_string()));
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, issue_key, export_path, exported_at
             FROM exports
             ORDER BY exported_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(ExportHistory {
                id: row.get(0)?,
                issue_key: row.get(1)?,
                export_path: row.get(2)?,
                exported_at: row.get(3)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn clear_exports(&self) -> AppResult<()> {
        self.conn.execute("DELETE FROM exports", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Db;
    use crate::models::IssueSummary;

    #[test]
    fn upsert_and_search_issue_summary() {
        let conn = rusqlite::Connection::open_in_memory().expect("open memory db");
        let db = Db { conn };
        db.init_schema().expect("schema");

        db.upsert_issue_summary(&IssueSummary {
            issue_key: "PROJ-1".to_string(),
            summary: "hello world".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        })
        .expect("upsert");

        let found = db
            .search_issue_summaries_local("hello")
            .expect("search should work");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].issue_key, "PROJ-1");
    }
}
