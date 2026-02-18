use keyring::Entry;

use crate::app_error::AppResult;

const SERVICE: &str = "com.company.backlog-markdown-exporter";
const USERNAME: &str = "backlog-api-key";

pub fn save_api_key(api_key: &str) -> AppResult<()> {
    Entry::new(SERVICE, USERNAME)?.set_password(api_key.trim())?;
    Ok(())
}

pub fn load_api_key() -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE, USERNAME)?;
    match entry.get_password() {
        Ok(v) => {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_api_key() -> AppResult<()> {
    let entry = Entry::new(SERVICE, USERNAME)?;
    match entry.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
