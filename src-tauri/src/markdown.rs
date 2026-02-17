use regex::Regex;

pub fn backlog_to_markdown(input: &str) -> String {
    let mut out = input.to_string();

    let heading_rules = [(r"(?m)^h1\.\s+", "# "), (r"(?m)^h2\.\s+", "## "), (r"(?m)^h3\.\s+", "### ")];
    for (pattern, replace) in heading_rules {
        let re = Regex::new(pattern).expect("valid regex");
        out = re.replace_all(&out, replace).to_string();
    }

    let list_re = Regex::new(r"(?m)^\*\s+").expect("valid regex");
    out = list_re.replace_all(&out, "- ").to_string();

    let inline_code_re = Regex::new(r"\{\{\s*(.*?)\s*\}\}").expect("valid regex");
    out = inline_code_re.replace_all(&out, "`$1`").to_string();

    // Fallback flattening for common unsupported wiki decorations.
    let unsupported_rules = [
        (r"\[\[(.*?)\]\]", "$1"),
        (r"\{color:[^}]*\}", ""),
        (r"\{color\}", ""),
        (r"\{quote\}", ""),
        (r"\{\{", ""),
        (r"\}\}", ""),
    ];

    for (pattern, replace) in unsupported_rules {
        let re = Regex::new(pattern).expect("valid regex");
        out = re.replace_all(&out, replace).to_string();
    }

    out
}

#[cfg(test)]
mod tests {
    use super::backlog_to_markdown;

    #[test]
    fn converts_supported_syntax() {
        let input = "h1. Title\nh2. Sec\nh3. Sub\n* item\n{{ code }}";
        let md = backlog_to_markdown(input);
        assert!(md.contains("# Title"));
        assert!(md.contains("## Sec"));
        assert!(md.contains("### Sub"));
        assert!(md.contains("- item"));
        assert!(md.contains("`code`"));
    }

    #[test]
    fn flattens_unsupported_markup() {
        let input = "{color:red}warn{color} and [[link text]]";
        let md = backlog_to_markdown(input);
        assert_eq!(md, "warn and link text");
    }
}
