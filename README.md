# Raw Prompt Commands

Exposes SillyTavern's built-in prompt itemizer data as slash commands, so the raw prompt can be piped into other STscript commands instead of being read out of a popup.

## Install

Drop the folder into:

```
SillyTavern/public/scripts/extensions/third-party/st-raw-prompt/
```

Then reload the UI. The relative imports in `index.js` assume exactly that depth, so renaming the folder is fine but moving it is not.

## Commands

| Command | Returns |
| --- | --- |
| `/rawprompt [mesId]` | The raw prompt text for a message |
| `/rawpromptstats [mesId]` | Derived token counts and metadata as JSON |
| `/rawpromptdata [mesId]` | The stored itemizer entry as JSON |
| `/rawpromptids` | Message IDs that have a cached prompt |

`/rawprompt` takes `format=text\|json`, `role=system\|user\|assistant`, and `which=last\|first`. The message ID is optional and defaults to the last message in the chat, the same as `{{lastMessageId}}`. Negative numbers count back from the end.

STscript substitutes the pipe for an omitted unnamed argument, so a command placed after a `|` can receive a number it never asked for. Anything out of range is ignored with a console warning rather than failing. To target a specific message from inside a pipe, use the named form, which is never pipe-injected:

```stscript
/rawprompt mes=42
```

```stscript
/rawprompt | /len
/rawprompt role=system format=json
/rawpromptstats | /getat index=finalPromptTokens
/rawpromptdata | /getat index=oaiTotalTokens
```

`/rawpromptdata` drops any string over 200 characters so you get counts and metadata without the prompt body; `full=on` keeps them. `rawPrompt` is always excluded.

## Caveats

Itemized prompts live in localforage per chat and are only written when a message is generated, so imported chats and messages from before the cache was cleared return nothing. Use `/rawpromptids` to see what is actually available.

On Chat Completion the stored prompt is an array of `{role, content}` objects; `format=text` joins the contents with newlines, which is what the itemizer popup displays. On Text Completion it is already a single string, and `role=` does nothing.
