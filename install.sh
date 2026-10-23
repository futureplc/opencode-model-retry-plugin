#!/bin/sh

usage() {
    printf '%s\n' 'Usage: sh ./install.sh [--global | --target <directory>]' 'Global installation is the default.'
}

fail() {
    printf 'Installer failed: %s\n' "$1" >&2
    exit 1
}

parse_arguments() {
    mode=global
    case $#:$1 in
        0:|1:--global) ;;
        1:--help) usage; exit 0 ;;
        2:--target)
            case $2 in
                ''|--*) usage >&2; exit 1 ;;
                *) mode=target; target=$2 ;;
            esac ;;
        *) usage >&2; exit 1 ;;
    esac
}

resolve_config() {
    if [ "$mode" = target ]; then
        case $target in
            /*) ;;
            *) target=$caller_directory/$target ;;
        esac
        config=$target/config/opencode
    elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
        case $XDG_CONFIG_HOME in
            /*) config=$XDG_CONFIG_HOME/opencode ;;
            *) fail 'XDG_CONFIG_HOME must be absolute; set an absolute path or unset it.' ;;
        esac
    else
        case ${HOME:-} in
            /*) config=$HOME/.config/opencode ;;
            *) fail 'HOME must be non-empty and absolute; set it, set an absolute XDG_CONFIG_HOME, or use --target.' ;;
        esac
    fi
}

check_plugin_directory() {
    if [ -L "$directory" ]; then
        fail "Refusing symbolic link at $directory; move it aside before rerunning."
    fi
    if [ -e "$directory" ] && [ ! -d "$directory" ]; then
        fail "Expected directory at $directory; move the conflicting entry aside and rerun."
    fi
}

check_destination() {
    if [ -L "$destination" ]; then
        fail "Refusing symbolic link at $destination; move it aside before rerunning."
    fi
    if [ -e "$destination" ] && [ ! -f "$destination" ]; then
        fail "Expected regular file at $destination; move the conflicting entry aside and rerun."
    fi
    if [ -f "$destination" ]; then
        cmp -s "$source" "$destination"
        case $? in
            0) return 0 ;;
            1) return 2 ;;
            *) fail "Cannot inspect $source and $destination; check the paths and permissions, then rerun." ;;
        esac
    fi
    return 1
}

copy_source() {
    mkdir -p "$directory" || fail "Cannot create $directory; check the path and permissions, then rerun."
    if ! (set -C; cat "$source" > "$destination"); then
        fail "Cannot copy source to $destination; a partial file may remain. Inspect or move it aside before rerunning."
    fi
}

update_source() {
    attempt=0
    while [ "$attempt" -lt 100 ]; do
        staging=$directory/.index.ts.tmp.$$.$attempt
        if (umask 077; set -C; : > "$staging") 2>/dev/null; then
            break
        fi
        staging=
        attempt=$((attempt + 1))
    done
    [ -n "$staging" ] || fail "Cannot create a staging file in $directory; check the path and permissions, then rerun."

    if ! cat "$source" > "$staging"; then
        if rm -f "$staging"; then
            fail "Cannot write the update for $destination; the existing file was preserved. Check the source and permissions, then rerun."
        fi
        fail "Cannot write the update for $destination; the existing file was preserved, but the staging file remains at $staging. Inspect and remove it before rerunning."
    fi

    current_umask=$(umask)
    final_mode=$(printf '%o' "$((0666 & ~current_umask))")
    if ! chmod "$final_mode" "$staging"; then
        if rm -f "$staging"; then
            fail "Cannot set final permissions for the update to $destination; the existing file was preserved. Check the path and permissions, then rerun."
        fi
        fail "Cannot set final permissions for the update to $destination; the existing file was preserved, but the staging file remains at $staging. Inspect and remove it before rerunning."
    fi

    if ! mv -f "$staging" "$destination"; then
        if rm -f "$staging"; then
            fail "Cannot replace $destination with the update; the existing file was preserved. Check the path and permissions, then rerun."
        fi
        fail "Cannot replace $destination with the update; the existing file was preserved, but the staging file remains at $staging. Inspect and remove it before rerunning."
    fi
}

configuration_path() {
    if [ ! -e "$1/opencode.json" ] && [ -e "$1/opencode.jsonc" ]; then
        printf '%s\n' "$1/opencode.jsonc"
    else
        printf '%s\n' "$1/opencode.json"
    fi
}

registration_example() {
    printf 'Configuration example for %s:\n' "$1"
    cat <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "$2",
      "options": {
        "fallbackModel": "openai/gpt-6-luna",
        "maxRetries": 10,
        "retriesBeforeFallabck": 5
      }
    }
  ]
}
EOF
}

print_setup() {
    if [ "$mode" = target ]; then
        printf 'Files prepared; setup remains. Installed source: %s\n' "$destination"
        printf '%s\n' 'Append or merge the following entry into existing plugins; do not replace other entries.'
    else
        printf 'Installation complete. Installed source: %s\n' "$destination"
        printf '%s\n' 'The global plugin directory is auto-discovered and loads with default options. Add a configuration entry only to configure or override options.'
        printf '%s\n' 'Optional configuration example; append or merge it into existing plugins, do not replace other entries.'
    fi
    registration_example "$(configuration_path "$config")" './plugins/opencode-model-switch-on-failure'
    if [ "$mode" = target ]; then
        printf '%s\n' "This custom configuration location is not auto-discovered. Alternatively, append or merge this entry into the project's root configuration:"
        registration_example "$(configuration_path "$target")" './config/opencode/plugins/opencode-model-switch-on-failure'
    fi
    printf '%s\n' 'Relative package entries resolve from the configuration file containing the entry.' 'fallbackModel is optional; the default is openai/gpt-6-luna.'
}

parse_arguments "$@"
caller_directory=$(pwd -P) || fail 'Cannot resolve the current directory; change to an accessible directory and rerun.'
case $0 in
    /*) script_path=$0 ;;
    *) script_path=$caller_directory/$0 ;;
esac
script_directory=$(CDPATH= cd -P "$(dirname "$script_path")" && pwd -P) || fail "Cannot locate installer directory for $script_path; check the path and rerun."
source=$script_directory/model-switch-on-failure.ts
resolve_config
[ -f "$source" ] && [ -r "$source" ] || fail "Cannot read regular source file $source; restore it or check permissions, then rerun."
directory=$config/plugins/opencode-model-switch-on-failure
destination=$directory/index.ts
check_plugin_directory
check_destination
destination_state=$?
case $destination_state in
    0) ;;
    1) copy_source ;;
    2) update_source ;;
esac
print_setup
