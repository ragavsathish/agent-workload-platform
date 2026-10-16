#!/bin/sh
set -eu

password_file="${HABITAT_DB_PASSWORD_FILE:?set HABITAT_DB_PASSWORD_FILE}"
HABITAT_DB_PASSWORD="$(cat "$password_file")"
export HABITAT_DB_PASSWORD

exec /usr/local/bin/habitat "$@"
