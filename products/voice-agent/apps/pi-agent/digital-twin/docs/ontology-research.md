# Personal digital twin vocabulary decision

Keep the first version small and use established vocabularies instead of creating a custom ontology:

- [Schema.org](https://schema.org/) for the person, organizations, education, skills, messages, and documents.
- [W3C Organization Ontology](https://www.w3.org/TR/vocab-org/) for employment memberships and roles.
- [W3C PROV-O](https://www.w3.org/TR/prov-o/) with Dublin Core Terms for source provenance.

The CV and conversation are evidence sources, not ontologies. Store derived facts and their source
metadata in separate named graphs. Keep the real data local and Git-ignored; commit only examples,
queries, and loader tooling.

Do not add confidence scoring, inference, ESCO mappings, detailed temporal ontologies, contact data,
or a custom preference model until a concrete use case requires them.

## Transcript ingestion

Treat model output as a candidate assertion, not as a profile fact. A discriminative decision model
selects one of `conversation_topic`, `skill_evidence`, `profile_update`, or `none`; a generative model
extracts only the candidate label and a verbatim evidence quote. Low-confidence decisions require
review, and SHACL validates the RDF structure before storage. Promotion into the CV graph remains an
explicit review action.
