An Apple silicon build. It is signed ad-hoc and not notarised, because notarising asks for a
developer account this project does not have.

macOS refuses a copy that arrived through a browser on its first launch. **Right click and Open is
not the way round it any more**: that path is gone on macOS 26. The shorter way is to take off the
flag the browser set, which is what macOS looks at:

```bash
mv ~/Downloads/Clawdeen.app /Applications/ && xattr -dr com.apple.quarantine /Applications/Clawdeen.app
```

The other way is `Open Anyway` under System Settings, Privacy & Security, which asks for an
administrator password. Either is per copy, so the next download asks again.

The README says what the board reads and what it keeps.
