# Sourced by the deploy scripts that run from cron. Finds the repo root from the script's own path
# and loads .env WITHOUT executing it: each KEY=VALUE line is read as data, surrounding single or
# double quotes are removed, and nothing in a value is expanded or run. Variables that are already
# set in the environment win, as with dotenv.
#   . "$(dirname "${BASH_SOURCE[0]}")/env.sh"   then use $ROOT and the .env values.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT

load_env() {
  local file="$1" line key val
  [ -f "$file" ] || { echo "No $file. Create it from .env.example first." >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    # Skip blanks and comments; accept an optional leading "export ".
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    line="${line#export }"
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    # Trim surrounding whitespace, then one pair of matching quotes.
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    [ -n "${!key+x}" ] && continue
    export "$key=$val"
  done < "$file"
}

load_env "$ROOT/.env"
