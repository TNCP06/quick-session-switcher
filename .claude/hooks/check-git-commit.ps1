# PreToolUse hook — blocks Claude from running `git commit` directly.
# Claude must write the commit command to PENDING_COMMIT.md instead.
# Receives tool input as JSON via stdin.

$json = [System.Console]::In.ReadToEnd()
try {
    $data  = $json | ConvertFrom-Json
    $cmd   = $data.tool_input.command
} catch {
    exit 0
}

if ($cmd -match '\bgit\s+commit\b') {
    Write-Host ""
    Write-Host "HOOK BLOCKED: Claude must not run 'git commit' directly."
    Write-Host "Rule (CLAUDE.md > Git Workflow): write the full commit command to PENDING_COMMIT.md."
    Write-Host "The user will run the commit manually so Co-Authored-By does not appear in public history."
    Write-Host ""
    exit 2
}

exit 0
