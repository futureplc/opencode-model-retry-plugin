Testing:

- Start opencode logs
```tail -f ~/.local/share/opencode/log/opencode.log ```

- Run mock provider that returns 429
```cd ~/.config/opencode/test ```
```node mock-provider.ts```

- Switch model to mock-gpt-4o and run a command
- Ask Opencode to run 'mock-429-log-test' skill to run a sub agent using the mock-gpt-4o model
