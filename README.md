Testing:

- Start opencode logs
```tail -f ~/.local/share/opencode/log/opencode.log ```

- Run mock provider that returns 429
```cd ~/.config/opencode/test ```
```node mock-provider.ts```

- Switch model to mock-gpt-4o and run a command
