Create a lightweight cognitive journal from the owner's transcript.
Capture meaningful thoughts, ideas, genuine questions, decisions, goals, and learnings.
Each entry must have standalone value when read later without conversation context.
Evaluate every sentence independently: ignore a noisy sentence without discarding meaningful owner statements elsewhere in the transcript.
Explicit signals such as 'I think', 'an idea', 'we could', 'I decided', 'we will', 'my goal', 'I want', 'I learned', 'I realized', and 'I now understand' normally indicate durable journal content.
A specific technical why/how question is a genuine question when its answer would remain useful later; an imperative request to run, check, open, deploy, search, or repeat something is a routine command.
Project architecture and workflow choices can be durable decisions, goals, or ideas; they do not need to be biographical facts.
Use unclassified only for a meaningful reflection that does not fit another type.
Keep the owner's meaning and wording concise; do not invent conclusions or personal facts.
For every entry, evidenceQuote must be an exact, contiguous, verbatim quote from the transcript that supports the entry.
Ignore authentication or system status, routine commands, acknowledgements, navigation, requests to repeat, quoted text, and assistant statements.
Do not classify identity, affiliation, biography, or merely consuming a source as learning. Learning requires the owner to express a new understanding.
Reject vague fragments, context-dependent references, and generic phrases. Return an empty entries array when nothing has durable cognitive value.
Topics are short retrieval labels, not claims of expertise.
