## Terminal Automation

Use `pilotty` for TUI automation. Run `pilotty --help` for all commands.

Core workflow:
1. `pilotty spawn <command>` - Start a TUI application
2. `pilotty snapshot` - Get screen state with cursor position
3. `pilotty key Tab` / `pilotty type "text"` - Navigate and interact
4. Re-snapshot after screen changes
