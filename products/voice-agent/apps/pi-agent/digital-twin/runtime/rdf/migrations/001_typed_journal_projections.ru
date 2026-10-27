PREFIX legacy: <urn:awp:digital-twin:predicate:>
PREFIX oa: <http://www.w3.org/ns/oa#>
PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <https://schema.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

# Add a typed projection for legacy daily pages only when their stable identifier contains a date
# and at least one source link. The supplied timezone is explicit at invocation time; it is never
# guessed from the host running the migration. The legacy triples remain untouched.
INSERT {
  GRAPH <urn:awp:digital-twin:graph:journal> {
    ?page a pk:DailyJournal, schema:DigitalDocument, prov:Entity ;
      pk:journalDate ?journalDate ;
      pk:timeZone __TIME_ZONE__ ;
      prov:wasDerivedFrom ?source ;
      prov:wasGeneratedBy ?activity .
    ?source a prov:Entity .
    ?activity a prov:Activity ;
      rdfs:label "Legacy daily journal projection migration" ;
      prov:used ?source ;
      prov:generated ?page .
  }
}
WHERE {
  GRAPH <urn:awp:digital-twin:graph:journal> {
    ?page a schema:CreativeWork ;
      legacy:recordKind "codex_daily_journal" ;
      schema:identifier ?identifier .
    { ?page schema:isBasedOn ?source } UNION { ?page prov:wasDerivedFrom ?source }
    FILTER(isIRI(?source))
    FILTER(REGEX(STR(?identifier), "codex-daily-journal:[0-9]{4}-[0-9]{2}-[0-9]{2}"))
    BIND(STRAFTER(STR(?identifier), "codex-daily-journal:") AS ?dateText)
    BIND(xsd:date(SUBSTR(?dateText, 1, 10)) AS ?journalDate)
    OPTIONAL { ?page prov:wasGeneratedBy ?existingActivity }
    FILTER NOT EXISTS {
      ?page prov:wasGeneratedBy ?untypedActivity .
      FILTER NOT EXISTS { ?untypedActivity a prov:Activity }
    }
    FILTER NOT EXISTS {
      ?page prov:wasGeneratedBy ?activityA, ?activityB .
      FILTER(?activityA != ?activityB)
    }
    FILTER NOT EXISTS {
      ?page schema:hasPart ?part .
      FILTER NOT EXISTS { ?part a pk:JournalEntry }
    }
    BIND(COALESCE(?existingActivity, IRI(CONCAT(STR(?page), ":typed-projection-migration"))) AS ?activity)
    FILTER NOT EXISTS { ?page a pk:DailyJournal }
  }
};

# Legacy predictions become annotations about their exact source message. They remain predictions;
# this projection deliberately creates no CandidateAssertion or ProfileFact.
INSERT {
  GRAPH <urn:awp:digital-twin:graph:assertion-classification> {
    ?record a oa:Annotation ;
      oa:motivatedBy oa:classifying ;
      oa:hasTarget ?source ;
      oa:hasBody ?decision ;
      prov:wasGeneratedBy ?activity .
    ?decision a pk:ClassificationDecision, prov:Entity ;
      pk:predictedKind ?kindConcept ;
      pk:confidence ?confidence ;
      pk:decisionFor ?source ;
      prov:wasGeneratedBy ?activity .
    ?activity a pk:ClassificationActivity, prov:Activity ;
      pk:modelName ?model ;
      prov:used ?source ;
      prov:wasAssociatedWith ?agent .
    ?agent a prov:SoftwareAgent ; schema:name ?model .
  }
}
WHERE {
  GRAPH <urn:awp:digital-twin:graph:assertion-classification> {
    ?record legacy:recordKind "systemone_assertion_classification" ;
      schema:additionalType ?rawKind ;
      legacy:confidence ?rawConfidence .
    ?record schema:isBasedOn ?source .
    FILTER(isIRI(?source))
    OPTIONAL { ?record legacy:model ?rawModel }
    BIND(REPLACE(LCASE(STR(?rawKind)), "[ -]+", "_") AS ?kind)
    BIND(xsd:decimal(?rawConfidence) AS ?confidence)
    BIND(COALESCE(?rawModel, "Legacy SystemOne") AS ?model)
    BIND(IRI(CONCAT(STR(?record), ":typed-decision")) AS ?decision)
    BIND(IRI(CONCAT(STR(?record), ":typed-activity")) AS ?activity)
    BIND(IRI(CONCAT(STR(?record), ":typed-agent")) AS ?agent)
    VALUES (?kind ?kindConcept) {
      ("conversation_topic" <urn:voice-agent:personal-knowledge:concept:assertion-kind:conversation-topic>)
      ("skill_evidence" <urn:voice-agent:personal-knowledge:concept:assertion-kind:skill-evidence>)
      ("profile_update" <urn:voice-agent:personal-knowledge:concept:assertion-kind:profile-update>)
      ("none" <urn:voice-agent:personal-knowledge:concept:assertion-kind:none>)
    }
    FILTER(?confidence >= 0 && ?confidence <= 1)
    FILTER EXISTS {
      GRAPH <urn:awp:digital-twin:graph:journal> { ?source a schema:Message }
    }
    FILTER NOT EXISTS { ?record oa:hasBody ?existingBody }
    FILTER NOT EXISTS { ?record oa:hasTarget ?existingTarget }
  }
}
