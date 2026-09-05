#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C
shopt -u nocasematch

readonly administrator_username_pattern='^[a-z0-9][a-z0-9._-]{0,79}$'

entries=()
usernames=()
line=""
input_ended=false

notice() {
  printf '%s\n' "$1" >&2
}

prompt() {
  printf '%s' "$1" >&2
}

if command -v sha256sum >/dev/null 2>&1; then
  sha256_hex() {
    printf '%s' "$1" | sha256sum | cut -d ' ' -f 1
  }
else
  sha256_hex() {
    printf '%s' "$1" | shasum -a 256 | cut -d ' ' -f 1
  }
fi

read_line() {
  line=""
  if [[ $1 == 1 ]]; then
    IFS= read -r -s line && return 0
  else
    IFS= read -r line && return 0
  fi
  input_ended=true
}

while true; do
  prompt "Administrator username (finish on empty): "
  read_line 0
  username=$line
  if [[ -z $username ]]; then
    if (( ${#entries[@]} == 0 )); then
      notice "Rejected: add at least one administrator before finishing."
      exit 1
    fi
    break
  fi

  if [[ ! $username =~ $administrator_username_pattern ]]; then
    notice "Rejected: usernames start with a lowercase letter or digit and then contain only lowercase letters, digits, dots, underscores, and hyphens, up to 80 characters."
    continue
  fi

  duplicate=0
  for existing in ${usernames[@]+"${usernames[@]}"}; do
    if [[ $existing == "$username" ]]; then
      duplicate=1
      break
    fi
  done
  if (( duplicate == 1 )); then
    notice "Rejected: that username was already added."
    continue
  fi

  while true; do
    prompt "Password for $username (hidden): "
    read_line 1
    printf '\n' >&2
    if [[ -n $line ]]; then
      password=$line
      break
    fi
    if $input_ended; then
      notice "Rejected: the input ended before a password was entered."
      exit 1
    fi
    notice "Rejected: the password must not be empty."
  done

  usernames+=("$username")
  entries+=("$username:$(sha256_hex "$username:$password")")
  unset password
done

value=${entries[0]}
for ((index = 1; index < ${#entries[@]}; index++)); do
  value+=$'\n'"${entries[index]}"
done
printf "ADMIN_BASIC_AUTH_CREDENTIALS='%s'\n" "$value"
