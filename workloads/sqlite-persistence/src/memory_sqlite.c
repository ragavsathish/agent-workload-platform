#include "memory_js.h"
#include "sqlite3.h"

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DATABASE_PATH "data/memory.db"
#define MAX_BATCH_ITEMS 256
#define MAX_STRING_BYTES 65536
#define MAX_GRAPH_ITEMS 10000

typedef memory_js_string_t wit_string_t;
typedef memory_js_list_string_t string_list_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_entity_t entity_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_relation_t relation_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_knowledge_graph_t graph_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_list_entity_t entity_list_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_list_relation_t relation_list_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_observation_input_t observation_input_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_observation_result_t observation_result_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_observation_deletion_t observation_deletion_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_list_observation_input_t observation_input_list_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_list_observation_result_t observation_result_list_t;
typedef exports_microsoft_memory_js_knowledge_graph_ops_list_observation_deletion_t observation_deletion_list_t;

static const char *SCHEMA_SQL =
    "CREATE TABLE IF NOT EXISTS entities ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "name TEXT NOT NULL UNIQUE,"
    "entity_type TEXT NOT NULL);"
    "CREATE TABLE IF NOT EXISTS observations ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "entity_name TEXT NOT NULL,"
    "content TEXT NOT NULL);"
    "CREATE INDEX IF NOT EXISTS observations_entity_idx "
    "ON observations(entity_name,id);"
    "CREATE TABLE IF NOT EXISTS relations ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "from_entity TEXT NOT NULL,"
    "to_entity TEXT NOT NULL,"
    "relation_type TEXT NOT NULL,"
    "UNIQUE(from_entity,to_entity,relation_type));"
    "CREATE INDEX IF NOT EXISTS relations_from_idx "
    "ON relations(from_entity,id);"
    "CREATE INDEX IF NOT EXISTS relations_to_idx "
    "ON relations(to_entity,id);";

static bool fail(wit_string_t *error, const char *format, ...) {
  char message[512];
  va_list args;
  va_start(args, format);
  vsnprintf(message, sizeof(message), format, args);
  va_end(args);
  memory_js_string_dup(error, message);
  return false;
}

static bool fail_sqlite(wit_string_t *error, sqlite3 *database,
                        const char *operation) {
  return fail(error, "%s: %s", operation,
              database == NULL ? "unable to open SQLite database"
                               : sqlite3_errmsg(database));
}

static bool validate_string(const wit_string_t *value, const char *field,
                            wit_string_t *error) {
  if (value->len > MAX_STRING_BYTES) {
    return fail(error, "%s exceeds %u bytes", field, MAX_STRING_BYTES);
  }
  if (memchr(value->ptr, '\0', value->len) != NULL) {
    return fail(error, "%s contains a NUL byte", field);
  }
  return true;
}

static bool validate_list_size(size_t length, const char *field,
                               wit_string_t *error) {
  if (length > MAX_BATCH_ITEMS) {
    return fail(error, "%s exceeds %u items", field, MAX_BATCH_ITEMS);
  }
  return true;
}

static bool validate_strings(const string_list_t *values, const char *field,
                             wit_string_t *error) {
  if (!validate_list_size(values->len, field, error)) return false;
  for (size_t index = 0; index < values->len; index++) {
    if (!validate_string(&values->ptr[index], field, error)) return false;
  }
  return true;
}

static bool bind_text(sqlite3_stmt *statement, int index,
                      const wit_string_t *value) {
  return sqlite3_bind_text(statement, index, (const char *)value->ptr,
                           (int)value->len, SQLITE_TRANSIENT) == SQLITE_OK;
}

static bool prepare(sqlite3 *database, const char *sql, sqlite3_stmt **statement,
                    wit_string_t *error) {
  if (sqlite3_prepare_v2(database, sql, -1, statement, NULL) != SQLITE_OK) {
    return fail_sqlite(error, database, "prepare failed");
  }
  return true;
}

static bool execute(sqlite3 *database, const char *sql, const char *operation,
                    wit_string_t *error) {
  if (sqlite3_exec(database, sql, NULL, NULL, NULL) != SQLITE_OK) {
    return fail_sqlite(error, database, operation);
  }
  return true;
}

static bool open_database(sqlite3 **database, wit_string_t *error) {
  if (sqlite3_open_v2(DATABASE_PATH, database,
                      SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, NULL) !=
      SQLITE_OK) {
    fail_sqlite(error, *database, "open failed");
    if (*database != NULL) sqlite3_close(*database);
    *database = NULL;
    return false;
  }
  sqlite3_busy_timeout(*database, 2000);
  if (!execute(*database, SCHEMA_SQL, "schema initialization failed", error)) {
    sqlite3_close(*database);
    *database = NULL;
    return false;
  }
  return true;
}

static bool begin(sqlite3 *database, wit_string_t *error) {
  return execute(database, "BEGIN IMMEDIATE", "begin transaction failed", error);
}

static bool commit(sqlite3 *database, wit_string_t *error) {
  return execute(database, "COMMIT", "commit failed", error);
}

static void rollback(sqlite3 *database) {
  sqlite3_exec(database, "ROLLBACK", NULL, NULL, NULL);
}

static void copy_wit_string(wit_string_t *target, const wit_string_t *source) {
  memory_js_string_dup_n(target, (const char *)source->ptr, source->len);
}

static void copy_column(sqlite3_stmt *statement, int column,
                        wit_string_t *target) {
  const char *text = (const char *)sqlite3_column_text(statement, column);
  int length = sqlite3_column_bytes(statement, column);
  memory_js_string_dup_n(target, text == NULL ? "" : text, (size_t)length);
}

static bool append_string(string_list_t *list, const wit_string_t *value,
                          wit_string_t *error) {
  wit_string_t *resized =
      realloc(list->ptr, (list->len + 1) * sizeof(wit_string_t));
  if (resized == NULL) return fail(error, "unable to allocate string result");
  list->ptr = resized;
  copy_wit_string(&list->ptr[list->len], value);
  list->len++;
  return true;
}

static bool append_column_string(string_list_t *list, sqlite3_stmt *statement,
                                 int column, wit_string_t *error) {
  wit_string_t *resized =
      realloc(list->ptr, (list->len + 1) * sizeof(wit_string_t));
  if (resized == NULL) return fail(error, "unable to allocate string result");
  list->ptr = resized;
  copy_column(statement, column, &list->ptr[list->len]);
  list->len++;
  return true;
}

static bool copy_string_list(string_list_t *target, const string_list_t *source,
                             wit_string_t *error) {
  target->ptr = NULL;
  target->len = 0;
  for (size_t index = 0; index < source->len; index++) {
    if (!append_string(target, &source->ptr[index], error)) return false;
  }
  return true;
}

static bool append_entity(entity_list_t *list, const entity_t *source,
                          wit_string_t *error) {
  entity_t *resized = realloc(list->ptr, (list->len + 1) * sizeof(entity_t));
  if (resized == NULL) return fail(error, "unable to allocate entity result");
  list->ptr = resized;
  entity_t *target = &list->ptr[list->len];
  copy_wit_string(&target->name, &source->name);
  copy_wit_string(&target->entity_type, &source->entity_type);
  if (!copy_string_list(&target->observations, &source->observations, error)) {
    return false;
  }
  list->len++;
  return true;
}

static bool append_relation(relation_list_t *list, const relation_t *source,
                            wit_string_t *error) {
  relation_t *resized =
      realloc(list->ptr, (list->len + 1) * sizeof(relation_t));
  if (resized == NULL) return fail(error, "unable to allocate relation result");
  list->ptr = resized;
  relation_t *target = &list->ptr[list->len];
  copy_wit_string(&target->from_entity, &source->from_entity);
  copy_wit_string(&target->to_entity, &source->to_entity);
  copy_wit_string(&target->relation_type, &source->relation_type);
  list->len++;
  return true;
}

static bool validate_entity(const entity_t *entity, wit_string_t *error) {
  return validate_string(&entity->name, "entity name", error) &&
         validate_string(&entity->entity_type, "entity type", error) &&
         validate_strings(&entity->observations, "entity observations", error);
}

static bool validate_relation(const relation_t *relation, wit_string_t *error) {
  return validate_string(&relation->from_entity, "relation from-entity", error) &&
         validate_string(&relation->to_entity, "relation to-entity", error) &&
         validate_string(&relation->relation_type, "relation type", error);
}

static bool load_observations(sqlite3 *database, const wit_string_t *entity_name,
                              string_list_t *observations,
                              wit_string_t *error) {
  observations->ptr = NULL;
  observations->len = 0;
  sqlite3_stmt *statement = NULL;
  if (!prepare(database,
               "SELECT content FROM observations "
               "WHERE entity_name=?1 ORDER BY id",
               &statement, error)) {
    return false;
  }
  if (!bind_text(statement, 1, entity_name)) {
    sqlite3_finalize(statement);
    return fail_sqlite(error, database, "observation binding failed");
  }
  int status;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
    if (!append_column_string(observations, statement, 0, error)) {
      sqlite3_finalize(statement);
      return false;
    }
  }
  sqlite3_finalize(statement);
  if (status != SQLITE_DONE) {
    return fail_sqlite(error, database, "observation read failed");
  }
  return true;
}

static bool append_entity_row(sqlite3 *database, entity_list_t *entities,
                              sqlite3_stmt *statement, wit_string_t *error) {
  if (entities->len >= MAX_GRAPH_ITEMS) {
    return fail(error, "graph exceeds %u entities", MAX_GRAPH_ITEMS);
  }
  entity_t *resized =
      realloc(entities->ptr, (entities->len + 1) * sizeof(entity_t));
  if (resized == NULL) return fail(error, "unable to allocate entity result");
  entities->ptr = resized;
  entity_t *entity = &entities->ptr[entities->len];
  copy_column(statement, 0, &entity->name);
  copy_column(statement, 1, &entity->entity_type);
  if (!load_observations(database, &entity->name, &entity->observations, error)) {
    return false;
  }
  entities->len++;
  return true;
}

static bool append_relation_row(relation_list_t *relations,
                                sqlite3_stmt *statement, wit_string_t *error) {
  if (relations->len >= MAX_GRAPH_ITEMS) {
    return fail(error, "graph exceeds %u relations", MAX_GRAPH_ITEMS);
  }
  relation_t *resized =
      realloc(relations->ptr, (relations->len + 1) * sizeof(relation_t));
  if (resized == NULL) return fail(error, "unable to allocate relation result");
  relations->ptr = resized;
  relation_t *relation = &relations->ptr[relations->len];
  copy_column(statement, 0, &relation->from_entity);
  copy_column(statement, 1, &relation->to_entity);
  copy_column(statement, 2, &relation->relation_type);
  relations->len++;
  return true;
}

static bool clear_selected(sqlite3 *database, wit_string_t *error) {
  return execute(database,
                 "CREATE TEMP TABLE IF NOT EXISTS selected_names("
                 "name TEXT PRIMARY KEY);"
                 "DELETE FROM selected_names",
                 "selection initialization failed", error);
}

static bool select_name(sqlite3 *database, const wit_string_t *name,
                        wit_string_t *error) {
  sqlite3_stmt *statement = NULL;
  if (!prepare(database,
               "INSERT OR IGNORE INTO selected_names(name) VALUES(?1)",
               &statement, error)) {
    return false;
  }
  if (!bind_text(statement, 1, name) ||
      sqlite3_step(statement) != SQLITE_DONE) {
    sqlite3_finalize(statement);
    return fail_sqlite(error, database, "name selection failed");
  }
  sqlite3_finalize(statement);
  return true;
}

static bool load_graph(sqlite3 *database, const char *entity_sql,
                       const wit_string_t *query, bool all_relations,
                       graph_t *graph, wit_string_t *error) {
  graph->entities.ptr = NULL;
  graph->entities.len = 0;
  graph->relations.ptr = NULL;
  graph->relations.len = 0;
  sqlite3_stmt *statement = NULL;
  if (!prepare(database, entity_sql, &statement, error)) return false;
  if (query != NULL && !bind_text(statement, 1, query)) {
    sqlite3_finalize(statement);
    return fail_sqlite(error, database, "graph query binding failed");
  }
  int status;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
    if (!append_entity_row(database, &graph->entities, statement, error)) {
      sqlite3_finalize(statement);
      return false;
    }
  }
  sqlite3_finalize(statement);
  if (status != SQLITE_DONE) {
    return fail_sqlite(error, database, "entity read failed");
  }

  const char *relation_sql = all_relations
      ? "SELECT from_entity,to_entity,relation_type FROM relations ORDER BY id"
      : "SELECT from_entity,to_entity,relation_type FROM relations "
        "WHERE from_entity IN (SELECT name FROM selected_names) "
        "OR to_entity IN (SELECT name FROM selected_names) ORDER BY id";
  if (!prepare(database, relation_sql, &statement, error)) return false;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
    if (!append_relation_row(&graph->relations, statement, error)) {
      sqlite3_finalize(statement);
      return false;
    }
  }
  sqlite3_finalize(statement);
  if (status != SQLITE_DONE) {
    return fail_sqlite(error, database, "relation read failed");
  }
  return true;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_create_entities(
    entity_list_t *entities, entity_list_t *result, wit_string_t *error) {
  result->ptr = NULL;
  result->len = 0;
  if (!validate_list_size(entities->len, "entities", error)) return false;
  for (size_t index = 0; index < entities->len; index++) {
    if (!validate_entity(&entities->ptr[index], error)) return false;
  }
  sqlite3 *database = NULL;
  sqlite3_stmt *insert_entity = NULL;
  sqlite3_stmt *insert_observation = NULL;
  if (!open_database(&database, error) || !begin(database, error) ||
      !prepare(database,
               "INSERT OR IGNORE INTO entities(name,entity_type) VALUES(?1,?2)",
               &insert_entity, error) ||
      !prepare(database,
               "INSERT INTO observations(entity_name,content) VALUES(?1,?2)",
               &insert_observation, error)) {
    if (database != NULL) {
      rollback(database);
      sqlite3_close(database);
    }
    return false;
  }
  for (size_t index = 0; index < entities->len; index++) {
    entity_t *entity = &entities->ptr[index];
    sqlite3_reset(insert_entity);
    sqlite3_clear_bindings(insert_entity);
    if (!bind_text(insert_entity, 1, &entity->name) ||
        !bind_text(insert_entity, 2, &entity->entity_type) ||
        sqlite3_step(insert_entity) != SQLITE_DONE) {
      fail_sqlite(error, database, "entity insert failed");
      goto create_entities_failed;
    }
    if (sqlite3_changes(database) == 0) continue;
    for (size_t observation = 0; observation < entity->observations.len;
         observation++) {
      sqlite3_reset(insert_observation);
      sqlite3_clear_bindings(insert_observation);
      if (!bind_text(insert_observation, 1, &entity->name) ||
          !bind_text(insert_observation, 2,
                     &entity->observations.ptr[observation]) ||
          sqlite3_step(insert_observation) != SQLITE_DONE) {
        fail_sqlite(error, database, "observation insert failed");
        goto create_entities_failed;
      }
    }
    if (!append_entity(result, entity, error)) goto create_entities_failed;
  }
  sqlite3_finalize(insert_entity);
  sqlite3_finalize(insert_observation);
  if (!commit(database, error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  sqlite3_close(database);
  return true;

create_entities_failed:
  sqlite3_finalize(insert_entity);
  sqlite3_finalize(insert_observation);
  rollback(database);
  sqlite3_close(database);
  return false;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_create_relations(
    relation_list_t *relations, relation_list_t *result, wit_string_t *error) {
  result->ptr = NULL;
  result->len = 0;
  if (!validate_list_size(relations->len, "relations", error)) return false;
  for (size_t index = 0; index < relations->len; index++) {
    if (!validate_relation(&relations->ptr[index], error)) return false;
  }
  sqlite3 *database = NULL;
  sqlite3_stmt *statement = NULL;
  if (!open_database(&database, error) || !begin(database, error) ||
      !prepare(database,
               "INSERT OR IGNORE INTO relations("
               "from_entity,to_entity,relation_type) VALUES(?1,?2,?3)",
               &statement, error)) {
    if (database != NULL) {
      rollback(database);
      sqlite3_close(database);
    }
    return false;
  }
  for (size_t index = 0; index < relations->len; index++) {
    relation_t *relation = &relations->ptr[index];
    sqlite3_reset(statement);
    sqlite3_clear_bindings(statement);
    if (!bind_text(statement, 1, &relation->from_entity) ||
        !bind_text(statement, 2, &relation->to_entity) ||
        !bind_text(statement, 3, &relation->relation_type) ||
        sqlite3_step(statement) != SQLITE_DONE) {
      fail_sqlite(error, database, "relation insert failed");
      sqlite3_finalize(statement);
      rollback(database);
      sqlite3_close(database);
      return false;
    }
    if (sqlite3_changes(database) > 0 &&
        !append_relation(result, relation, error)) {
      sqlite3_finalize(statement);
      rollback(database);
      sqlite3_close(database);
      return false;
    }
  }
  sqlite3_finalize(statement);
  if (!commit(database, error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  sqlite3_close(database);
  return true;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_add_observations(
    observation_input_list_t *observations, observation_result_list_t *result,
    wit_string_t *error) {
  result->ptr = NULL;
  result->len = 0;
  if (!validate_list_size(observations->len, "observation inputs", error)) {
    return false;
  }
  for (size_t index = 0; index < observations->len; index++) {
    if (!validate_string(&observations->ptr[index].entity_name, "entity name",
                         error) ||
        !validate_strings(&observations->ptr[index].contents,
                          "observation contents", error)) {
      return false;
    }
  }
  sqlite3 *database = NULL;
  sqlite3_stmt *entity_exists = NULL;
  sqlite3_stmt *observation_exists = NULL;
  sqlite3_stmt *insert_observation = NULL;
  if (!open_database(&database, error) || !begin(database, error) ||
      !prepare(database, "SELECT 1 FROM entities WHERE name=?1", &entity_exists,
               error) ||
      !prepare(database,
               "SELECT 1 FROM observations "
               "WHERE entity_name=?1 AND content=?2 LIMIT 1",
               &observation_exists, error) ||
      !prepare(database,
               "INSERT INTO observations(entity_name,content) VALUES(?1,?2)",
               &insert_observation, error)) {
    if (database != NULL) {
      rollback(database);
      sqlite3_close(database);
    }
    return false;
  }
  result->ptr = calloc(observations->len, sizeof(observation_result_t));
  if (observations->len > 0 && result->ptr == NULL) {
    fail(error, "unable to allocate observation result");
    goto add_observations_failed;
  }
  result->len = observations->len;
  for (size_t index = 0; index < observations->len; index++) {
    observation_input_t *input = &observations->ptr[index];
    observation_result_t *output = &result->ptr[index];
    copy_wit_string(&output->entity_name, &input->entity_name);
    output->added_observations.ptr = NULL;
    output->added_observations.len = 0;
    sqlite3_reset(entity_exists);
    sqlite3_clear_bindings(entity_exists);
    if (!bind_text(entity_exists, 1, &input->entity_name) ||
        sqlite3_step(entity_exists) != SQLITE_ROW) {
      fail(error, "Entity with name %.*s not found", (int)input->entity_name.len,
           (const char *)input->entity_name.ptr);
      goto add_observations_failed;
    }
    for (size_t content = 0; content < input->contents.len; content++) {
      wit_string_t *value = &input->contents.ptr[content];
      sqlite3_reset(observation_exists);
      sqlite3_clear_bindings(observation_exists);
      if (!bind_text(observation_exists, 1, &input->entity_name) ||
          !bind_text(observation_exists, 2, value)) {
        fail_sqlite(error, database, "observation lookup binding failed");
        goto add_observations_failed;
      }
      int status = sqlite3_step(observation_exists);
      if (status == SQLITE_ROW) continue;
      if (status != SQLITE_DONE) {
        fail_sqlite(error, database, "observation lookup failed");
        goto add_observations_failed;
      }
      sqlite3_reset(insert_observation);
      sqlite3_clear_bindings(insert_observation);
      if (!bind_text(insert_observation, 1, &input->entity_name) ||
          !bind_text(insert_observation, 2, value) ||
          sqlite3_step(insert_observation) != SQLITE_DONE) {
        fail_sqlite(error, database, "observation insert failed");
        goto add_observations_failed;
      }
      if (!append_string(&output->added_observations, value, error)) {
        goto add_observations_failed;
      }
    }
  }
  sqlite3_finalize(entity_exists);
  sqlite3_finalize(observation_exists);
  sqlite3_finalize(insert_observation);
  if (!commit(database, error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  sqlite3_close(database);
  return true;

add_observations_failed:
  sqlite3_finalize(entity_exists);
  sqlite3_finalize(observation_exists);
  sqlite3_finalize(insert_observation);
  rollback(database);
  sqlite3_close(database);
  return false;
}

static bool delete_by_string_list(sqlite3 *database, const char *sql,
                                  string_list_t *values,
                                  const char *operation,
                                  wit_string_t *error) {
  sqlite3_stmt *statement = NULL;
  if (!prepare(database, sql, &statement, error)) return false;
  for (size_t index = 0; index < values->len; index++) {
    sqlite3_reset(statement);
    sqlite3_clear_bindings(statement);
    if (!bind_text(statement, 1, &values->ptr[index]) ||
        sqlite3_step(statement) != SQLITE_DONE) {
      sqlite3_finalize(statement);
      return fail_sqlite(error, database, operation);
    }
  }
  sqlite3_finalize(statement);
  return true;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_delete_entities(
    string_list_t *entity_names, wit_string_t *error) {
  if (!validate_strings(entity_names, "entity names", error)) return false;
  sqlite3 *database = NULL;
  if (!open_database(&database, error) || !begin(database, error)) {
    if (database != NULL) sqlite3_close(database);
    return false;
  }
  if (!delete_by_string_list(
          database, "DELETE FROM observations WHERE entity_name=?1",
          entity_names, "observation cascade failed", error) ||
      !delete_by_string_list(
          database,
          "DELETE FROM relations WHERE from_entity=?1 OR to_entity=?1",
          entity_names, "relation cascade failed", error) ||
      !delete_by_string_list(database, "DELETE FROM entities WHERE name=?1",
                             entity_names, "entity delete failed", error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  if (!commit(database, error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  sqlite3_close(database);
  return true;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_delete_observations(
    observation_deletion_list_t *deletions, wit_string_t *error) {
  if (!validate_list_size(deletions->len, "observation deletions", error)) {
    return false;
  }
  for (size_t index = 0; index < deletions->len; index++) {
    if (!validate_string(&deletions->ptr[index].entity_name, "entity name",
                         error) ||
        !validate_strings(&deletions->ptr[index].observations,
                          "observations", error)) {
      return false;
    }
  }
  sqlite3 *database = NULL;
  sqlite3_stmt *entity_exists = NULL;
  sqlite3_stmt *delete_observation = NULL;
  if (!open_database(&database, error) || !begin(database, error) ||
      !prepare(database, "SELECT 1 FROM entities WHERE name=?1", &entity_exists,
               error) ||
      !prepare(database,
               "DELETE FROM observations WHERE id=("
               "SELECT id FROM observations "
               "WHERE entity_name=?1 AND content=?2 ORDER BY id LIMIT 1)",
               &delete_observation, error)) {
    if (database != NULL) {
      rollback(database);
      sqlite3_close(database);
    }
    return false;
  }
  for (size_t index = 0; index < deletions->len; index++) {
    observation_deletion_t *deletion = &deletions->ptr[index];
    sqlite3_reset(entity_exists);
    sqlite3_clear_bindings(entity_exists);
    if (!bind_text(entity_exists, 1, &deletion->entity_name) ||
        sqlite3_step(entity_exists) != SQLITE_ROW) {
      fail(error, "Entity with name %.*s not found",
           (int)deletion->entity_name.len,
           (const char *)deletion->entity_name.ptr);
      goto delete_observations_failed;
    }
    for (size_t observation = 0;
         observation < deletion->observations.len; observation++) {
      sqlite3_reset(delete_observation);
      sqlite3_clear_bindings(delete_observation);
      if (!bind_text(delete_observation, 1, &deletion->entity_name) ||
          !bind_text(delete_observation, 2,
                     &deletion->observations.ptr[observation]) ||
          sqlite3_step(delete_observation) != SQLITE_DONE) {
        fail_sqlite(error, database, "observation delete failed");
        goto delete_observations_failed;
      }
    }
  }
  sqlite3_finalize(entity_exists);
  sqlite3_finalize(delete_observation);
  if (!commit(database, error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  sqlite3_close(database);
  return true;

delete_observations_failed:
  sqlite3_finalize(entity_exists);
  sqlite3_finalize(delete_observation);
  rollback(database);
  sqlite3_close(database);
  return false;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_delete_relations(
    relation_list_t *relations, wit_string_t *error) {
  if (!validate_list_size(relations->len, "relations", error)) return false;
  for (size_t index = 0; index < relations->len; index++) {
    if (!validate_relation(&relations->ptr[index], error)) return false;
  }
  sqlite3 *database = NULL;
  sqlite3_stmt *statement = NULL;
  if (!open_database(&database, error) || !begin(database, error) ||
      !prepare(database,
               "DELETE FROM relations WHERE from_entity=?1 "
               "AND to_entity=?2 AND relation_type=?3",
               &statement, error)) {
    if (database != NULL) {
      rollback(database);
      sqlite3_close(database);
    }
    return false;
  }
  for (size_t index = 0; index < relations->len; index++) {
    relation_t *relation = &relations->ptr[index];
    sqlite3_reset(statement);
    sqlite3_clear_bindings(statement);
    if (!bind_text(statement, 1, &relation->from_entity) ||
        !bind_text(statement, 2, &relation->to_entity) ||
        !bind_text(statement, 3, &relation->relation_type) ||
        sqlite3_step(statement) != SQLITE_DONE) {
      fail_sqlite(error, database, "relation delete failed");
      sqlite3_finalize(statement);
      rollback(database);
      sqlite3_close(database);
      return false;
    }
  }
  sqlite3_finalize(statement);
  if (!commit(database, error)) {
    rollback(database);
    sqlite3_close(database);
    return false;
  }
  sqlite3_close(database);
  return true;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_read_graph(
    graph_t *result, wit_string_t *error) {
  sqlite3 *database = NULL;
  if (!open_database(&database, error)) return false;
  bool success = load_graph(
      database, "SELECT name,entity_type FROM entities ORDER BY id", NULL, true,
      result, error);
  sqlite3_close(database);
  return success;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_search_nodes(
    wit_string_t *query, graph_t *result, wit_string_t *error) {
  if (!validate_string(query, "query", error)) return false;
  sqlite3 *database = NULL;
  if (!open_database(&database, error) ||
      !clear_selected(database, error)) {
    if (database != NULL) sqlite3_close(database);
    return false;
  }
  sqlite3_stmt *selection = NULL;
  if (!prepare(database,
               "INSERT OR IGNORE INTO selected_names(name) "
               "SELECT e.name FROM entities e "
               "WHERE instr(lower(e.name),lower(?1))>0 "
               "OR instr(lower(e.entity_type),lower(?1))>0 "
               "OR EXISTS(SELECT 1 FROM observations o "
               "WHERE o.entity_name=e.name "
               "AND instr(lower(o.content),lower(?1))>0)",
               &selection, error)) {
    sqlite3_close(database);
    return false;
  }
  if (!bind_text(selection, 1, query) ||
      sqlite3_step(selection) != SQLITE_DONE) {
    sqlite3_finalize(selection);
    fail_sqlite(error, database, "search failed");
    sqlite3_close(database);
    return false;
  }
  sqlite3_finalize(selection);
  bool success = load_graph(
      database,
      "SELECT e.name,e.entity_type FROM entities e "
      "JOIN selected_names s ON s.name=e.name ORDER BY e.id",
      NULL, false, result, error);
  sqlite3_close(database);
  return success;
}

bool exports_microsoft_memory_js_knowledge_graph_ops_open_nodes(
    string_list_t *names, graph_t *result, wit_string_t *error) {
  if (!validate_strings(names, "node names", error)) return false;
  sqlite3 *database = NULL;
  if (!open_database(&database, error) ||
      !clear_selected(database, error)) {
    if (database != NULL) sqlite3_close(database);
    return false;
  }
  for (size_t index = 0; index < names->len; index++) {
    if (!select_name(database, &names->ptr[index], error)) {
      sqlite3_close(database);
      return false;
    }
  }
  bool success = load_graph(
      database,
      "SELECT e.name,e.entity_type FROM entities e "
      "JOIN selected_names s ON s.name=e.name ORDER BY e.id",
      NULL, false, result, error);
  sqlite3_close(database);
  return success;
}
