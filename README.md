# Raw Prompt Commands

Exposes SillyTavern's built-in prompt itemizer data as slash commands, so the raw prompt can be piped into other STscript commands instead of being read out of a popup.

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

# Sample Context Tracker and Summarization Reminder:

```
/rawpromptdata |
/getat index=this_max_context |
/let maxContext {{pipe}} |
/mul maxContext 0.9 |
/round |
/let 90 {{pipe}} |
/mul maxContext 0.75 |
/round |
/let 75 {{pipe}} |

/rawprompt {{lastMessageId}} |
/tokens |
/let currentContext {{pipe}} |

/if left={{var::currentContext}} right={{var::75}} rule=lt {:
    /setvar key=75_alert false | /setvar key=90_alert false |
:} |

/if left={{var::currentContext}} right={{var::75}} rule=gte else={::} {:
// If greater than 75% |
	/if left={{var::currentContext}} right={{var::90}} rule=gte else={:
	// If >75% but <90% |
		/if left={{getvar::75_alert}} right=true rule=eq else={:
			/echo Context at 75% - Ctx:{{var::currentContext}}/{{var::maxContext}} |
			/setvar key=75_alert true |
		:} {::} |
	:} {:
	// If greater than 90% |
		/if left={{getvar::90_alert}} right=true rule=eq else={:
			/echo Context at 90% - Ctx:{{var::currentContext}}/{{var::maxContext}} - Recommend Summarizing |
			/setvar key=90_alert true |
		:} {::} |
	:} |
:} |

/pass Ctx:{{var::currentContext}}/{{var::maxContext}} |
/setvar key=ctxDisp {{pipe}} |
```
