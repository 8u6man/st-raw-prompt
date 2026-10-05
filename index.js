import { chat } from '../../../../script.js';
import { itemizedPrompts, itemizedParams } from '../../../itemized-prompts.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue } from '../../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const MODULE_NAME = 'Raw Prompt Commands';

/** Strings longer than this are treated as prompt body text rather than metadata. */
const BIG_STRING_THRESHOLD = 200;

/**
 * @param {any} value
 * @returns {boolean}
 */
function isAffirmative(value) {
    return ['true', 'on', '1', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

/**
 * Collapses a rawPrompt into a single string.
 * Chat Completion stores an array of {role, content}; Text Completion stores a plain string.
 * This mirrors the `flatten` helper inside promptItemize().
 * @param {any} rawPrompt
 * @returns {string}
 */
function flattenRawPrompt(rawPrompt) {
    if (Array.isArray(rawPrompt)) {
        return rawPrompt.map(x => x?.content ?? '').join('\n');
    }
    return String(rawPrompt ?? '');
}

/**
 * Returns the indexes in itemizedPrompts that belong to a message id.
 * A message can have several entries (one per swipe / regeneration).
 * @param {number} mesId
 * @returns {number[]}
 */
function getPromptSetIndexes(mesId) {
    if (!Array.isArray(itemizedPrompts)) {
        return [];
    }

    const indexes = [];

    for (let i = 0; i < itemizedPrompts.length; i++) {
        if (Number(itemizedPrompts[i]?.mesId) === mesId) {
            indexes.push(i);
        }
    }

    return indexes;
}

/**
 * The last message in the chat, used when no id is given. Equivalent to {{lastMessageId}}.
 *
 * Deliberately not the last entry in itemizedPrompts: entries are appended in generation order, so
 * swiping an older message puts that message's id at the end of the array.
 *
 * @returns {number|null}
 */
function defaultMesId() {
    return Array.isArray(chat) && chat.length > 0 ? chat.length - 1 : null;
}

/**
 * Works out which message to look up.
 *
 * STscript injects the pipe into an omitted unnamed argument, so a command used after a `|` can
 * receive an arbitrary number it never asked for. Anything out of range therefore falls back to the
 * default instead of failing, unless it came from the explicit `mes=` argument, which is never
 * pipe-injected and so is always treated as deliberate.
 *
 * @param {any} args Named arguments
 * @param {any} value Unnamed argument
 * @returns {{mesId: number|null, explicit: boolean, invalid: boolean}}
 */
function resolveMesId(args, value) {
    const named = String(args?.mes ?? '').trim();
    const explicit = named !== '';
    const raw = explicit ? named : String(value ?? '').trim();

    if (raw === '' || raw.toLowerCase() === 'last') {
        return { mesId: defaultMesId(), explicit: false, invalid: false };
    }

    const parsed = Number(raw);
    const id = Number.isInteger(parsed) && parsed < 0 ? chat.length + parsed : parsed;
    const usable = Number.isInteger(id) && id >= 0 && id < chat.length;

    if (!usable) {
        if (explicit) {
            return { mesId: null, explicit: true, invalid: true };
        }

        console.warn(`[${MODULE_NAME}] ignoring unusable message id "${raw}" (likely injected by the pipe), falling back to the last message`);
        return { mesId: defaultMesId(), explicit: false, invalid: false };
    }

    return { mesId: id, explicit, invalid: false };
}

/**
 * Shared lookup for all commands.
 * @param {any} args Named arguments
 * @param {any} value Unnamed argument
 * @param {string} which 'last' or 'first' swipe entry
 * @returns {{mesId: number, index: number}|null}
 */
function locatePromptSet(args, value, which) {
    const { mesId, invalid } = resolveMesId(args, value);

    if (invalid) {
        toastr.warning('That message ID is not in this chat.', MODULE_NAME);
        return null;
    }

    if (mesId === null) {
        toastr.warning('This chat is empty.', MODULE_NAME);
        return null;
    }

    const indexes = getPromptSetIndexes(mesId);

    if (indexes.length === 0) {
        toastr.warning(`No itemized prompt found for message #${mesId}.`, MODULE_NAME);
        return null;
    }

    const index = String(which ?? 'last').toLowerCase() === 'first'
        ? indexes[0]
        : indexes[indexes.length - 1];

    return { mesId, index };
}

/**
 * /rawprompt
 */
async function rawPromptCallback(args, value) {
    const found = locatePromptSet(args, value, args?.which);

    if (!found) {
        return '';
    }

    let rawPrompt = itemizedPrompts[found.index]?.rawPrompt;

    const role = String(args?.role ?? '').trim().toLowerCase();

    if (role && Array.isArray(rawPrompt)) {
        rawPrompt = rawPrompt.filter(x => String(x?.role ?? '').toLowerCase() === role);
    }

    const format = String(args?.format ?? 'text').trim().toLowerCase();

    if (format === 'json') {
        return JSON.stringify(rawPrompt ?? null);
    }

    return flattenRawPrompt(rawPrompt);
}

/**
 * /rawpromptstats
 */
async function rawPromptStatsCallback(args, value) {
    const found = locatePromptSet(args, value, args?.which);

    if (!found) {
        return '';
    }

    try {
        const params = await itemizedParams(itemizedPrompts, found.index, found.mesId);
        return JSON.stringify(params);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to build itemized params`, error);
        toastr.error('Could not calculate prompt stats. See the console for details.', MODULE_NAME);
        return '';
    }
}

/**
 * /rawpromptdata
 */
function rawPromptDataCallback(args, value) {
    const found = locatePromptSet(args, value, args?.which);

    if (!found) {
        return '';
    }

    const entry = itemizedPrompts[found.index];

    if (!entry) {
        return '';
    }

    const includeAll = isAffirmative(args?.full);
    const result = {};

    for (const [key, val] of Object.entries(entry)) {
        // rawPrompt is the whole payload and is already available via /rawprompt.
        if (key === 'rawPrompt') {
            continue;
        }

        if (!includeAll && typeof val === 'string' && val.length > BIG_STRING_THRESHOLD) {
            continue;
        }

        result[key] = val;
    }

    return JSON.stringify(result);
}

/**
 * /rawpromptids
 */
function rawPromptIdsCallback() {
    if (!Array.isArray(itemizedPrompts)) {
        return '[]';
    }

    const ids = [...new Set(itemizedPrompts.map(x => Number(x?.mesId)))]
        .filter(x => Number.isInteger(x))
        .sort((a, b) => a - b);

    return JSON.stringify(ids);
}

const mesNamedArgument = () => SlashCommandNamedArgument.fromProps({
    name: 'mes',
    description: 'message ID. Use this instead of the unnamed argument inside a pipe, since an omitted unnamed argument receives the piped value.',
    typeList: [ARGUMENT_TYPE.NUMBER],
    isRequired: false,
});

const whichArgument = () => SlashCommandNamedArgument.fromProps({
    name: 'which',
    description: 'which entry to use when a message has been swiped/regenerated several times',
    typeList: [ARGUMENT_TYPE.STRING],
    defaultValue: 'last',
    enumList: [
        new SlashCommandEnumValue('last', 'most recent generation (default)'),
        new SlashCommandEnumValue('first', 'oldest generation, matches the built-in itemizer'),
    ],
});

const mesIdArgument = () => SlashCommandArgument.fromProps({
    description: 'message ID. Negative values count back from the end. Defaults to the last message in the chat, the same as {{lastMessageId}}.',
    typeList: [ARGUMENT_TYPE.NUMBER],
    isRequired: false,
});

function registerCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rawprompt',
        aliases: ['itemize'],
        callback: rawPromptCallback,
        returns: 'the raw prompt that was sent for a message',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'format',
                description: 'output format',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'text',
                enumList: [
                    new SlashCommandEnumValue('text', 'flattened plain text, same as the "Show Raw Prompt" view'),
                    new SlashCommandEnumValue('json', 'the stored structure, an array of {role, content} on Chat Completion'),
                ],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'role',
                description: 'only keep messages with this role (Chat Completion only)',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: [
                    new SlashCommandEnumValue('system'),
                    new SlashCommandEnumValue('user'),
                    new SlashCommandEnumValue('assistant'),
                ],
            }),
            mesNamedArgument(),
            whichArgument(),
        ],
        unnamedArgumentList: [mesIdArgument()],
        helpString: `
            <div>
                Returns the raw prompt recorded for a message, the same text the built-in prompt itemizer
                shows under "Show Raw Prompt".
            </div>
            <div>
                Nothing is returned if the message was never generated in this session, since itemized
                prompts are cached per chat and are not part of the chat file.
            </div>
            <div>
                <strong>Examples:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/rawprompt | /len</code></pre></li>
                    <li><pre><code class="language-stscript">/rawprompt 42</code></pre></li>
                    <li><pre><code class="language-stscript">/rawprompt role=system | /echo</code></pre></li>
                    <li><pre><code class="language-stscript">/rawprompt format=json {{lastMessageId}}</code></pre></li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rawpromptstats',
        callback: rawPromptStatsCallback,
        returns: 'a JSON object of token counts and metadata for a message',
        namedArgumentList: [mesNamedArgument(), whichArgument()],
        unnamedArgumentList: [mesIdArgument()],
        helpString: `
            <div>
                Returns the numbers behind the itemizer popup as JSON: per-section token counts, the
                tokenizer and preset names, the API and model used, context limits, and percentages.
            </div>
            <div>
                The exact keys differ between Chat Completion and Text Completion, since the itemizer
                builds a different set for each.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/rawpromptstats | /getat index=finalPromptTokens</code></pre></li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rawpromptdata',
        callback: rawPromptDataCallback,
        returns: 'the stored itemized prompt entry as JSON',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'full',
                description: 'include the long body-text fields as well',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'off',
                enumList: [
                    new SlashCommandEnumValue('off', 'metadata and counts only (default)'),
                    new SlashCommandEnumValue('on', 'everything except rawPrompt'),
                ],
            }),
            mesNamedArgument(),
            whichArgument(),
        ],
        unnamedArgumentList: [mesIdArgument()],
        helpString: `
            <div>
                Returns the raw entry that SillyTavern cached for a message, rather than the derived
                values that <code>/rawpromptstats</code> calculates from it.
            </div>
            <div>
                This is the only way to reach fields the itemizer stores but never copies into its own
                params, most usefully <code>oaiTotalTokens</code> on Chat Completion, plus
                <code>this_max_context</code>, <code>tokenizer</code> and <code>padding</code>.
            </div>
            <div>
                By default any string longer than ${BIG_STRING_THRESHOLD} characters is dropped, so you get
                counts and metadata without the prompt body. Pass <code>full=on</code> to keep them.
                <code>rawPrompt</code> is always excluded; use <code>/rawprompt</code> for that.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/rawpromptdata | /getat index=oaiTotalTokens</code></pre></li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rawpromptids',
        callback: rawPromptIdsCallback,
        returns: 'a JSON array of message IDs that have a cached prompt',
        helpString: `
            <div>
                Lists the message IDs that currently have an itemized prompt cached, which is handy for
                checking what is actually available before looping over messages.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li><pre><code class="language-stscript">/rawpromptids | /foreach {: /rawprompt {{var::item}} | /len :}</code></pre></li>
                </ul>
            </div>
        `,
    }));
}

registerCommands();
console.log(`[${MODULE_NAME}] registered /rawprompt, /rawpromptstats, /rawpromptdata and /rawpromptids`);
