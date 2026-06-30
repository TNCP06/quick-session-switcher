# PreToolUse hook — allows `git commit` but blocks any commit that carries a
# Co-Authored-By trailer, so attribution to Claude never lands in public history.
# Receives tool input as JSON via stdin.

$json = [System.Console]::In.ReadToEnd()
try {
    $data  = $json | ConvertFrom-Json
    $cmd   = $data.tool_input.command
} catch {
    exit 0
}

if ($cmd -match '\bgit\s+commit\b' -and $cmd -match '(?i)co-authored-by') {
    Write-Host ""
    Write-Host "HOOK BLOCKED: commit contains a Co-Authored-By trailer."
    Write-Host "Rule (CLAUDE.md > Git Workflow): commits must NOT include Co-Authored-By."
    Write-Host "Remove the trailer and commit again."
    Write-Host ""
    exit 2
}

exit 0
