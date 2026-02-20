/**
 * project_context MCP Resource
 *
 * Provides project metadata (suite tree, custom fields, tags, users, etc.)
 * so the AI can resolve human-readable names to numeric IDs.
 */

import { createHash } from "node:crypto";
import { getApiClient } from "../client/api-client.js";
import { getConfig } from "../config.js";
import { getRequestContext } from "../context.js";

type SuiteNode = {
  id: number;
  title: string;
  parent_id: number | null;
  children: SuiteNode[];
};

type TagNode = {
  id: number;
  name: string;
};

type CustomFieldNode = {
  id: number;
  name: string;
  label?: string;
  field_type?: string;
  options?: string[];
};

type RequirementNode = {
  id: number;
  title: string;
  requirement_key?: string;
  requirement_id?: string;
};

type ProjectUserNode = {
  id: number;
  name: string;
  email?: string;
  username?: string;
  role?: string;
};

type ProjectContextPayload = {
  project_id: number;
  suites: SuiteNode[];
  tags: TagNode[];
  custom_fields: CustomFieldNode[];
  requirements: RequirementNode[];
  users: ProjectUserNode[];
};

type CacheEntry = {
  expiresAt: number;
  payload: ProjectContextPayload;
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const contextCache = new Map<string, CacheEntry>();

const cacheTtlMs = (() => {
  const raw = process.env["TC_PROJECT_CONTEXT_CACHE_TTL_MS"];
  if (!raw) {
    return DEFAULT_CACHE_TTL_MS;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return DEFAULT_CACHE_TTL_MS;
})();

const logPrefix = "[TestCollab MCP]";
const apiLogPrefix = "[TestCollab MCP][API]";

const getField = <T>(item: unknown, key: string): T | undefined => {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  return (item as Record<string, unknown>)[key] as T | undefined;
};

const toNumberId = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getCompanyIdFromProject = (project: unknown): number | undefined => {
  if (!project || typeof project !== "object") {
    return undefined;
  }
  const company = (project as Record<string, unknown>)["company"];
  if (typeof company === "number" || typeof company === "string") {
    return toNumberId(company);
  }
  if (company && typeof company === "object") {
    return toNumberId((company as Record<string, unknown>)["id"]);
  }
  return undefined;
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const getCacheKey = (projectId: number): string => {
  const requestContext = getRequestContext();
  if (requestContext) {
    return `${requestContext.apiUrl}|${hashToken(requestContext.apiToken)}|${projectId}`;
  }
  const config = getConfig();
  return `${config.apiBaseUrl}|${hashToken(config.apiToken)}|${projectId}`;
};

const extractCustomFieldOptions = (extra: unknown): string[] | undefined => {
  const options = getField<unknown[]>(extra, "options");
  if (!Array.isArray(options)) {
    return undefined;
  }
  const normalized = options
    .map((option) => {
      if (typeof option === "string") {
        return option;
      }
      if (typeof option === "number") {
        return String(option);
      }
      if (option && typeof option === "object") {
        const label = getField<string>(option, "label");
        if (label) {
          return label;
        }
        const systemValue = getField<string | number>(option, "systemValue");
        if (systemValue !== undefined && systemValue !== null) {
          return String(systemValue);
        }
        const value = getField<string | number>(option, "value");
        if (value !== undefined && value !== null) {
          return String(value);
        }
      }
      return undefined;
    })
    .filter((value): value is string => Boolean(value && value.length));

  if (!normalized.length) {
    return undefined;
  }

  return Array.from(new Set(normalized));
};

const mapTags = (tags: unknown[]): TagNode[] =>
  tags
    .map((tag) => {
      const id = toNumberId(getField(tag, "id"));
      const name = getField<string>(tag, "name");
      if (!id || !name) {
        return null;
      }
      return { id, name };
    })
    .filter((tag): tag is TagNode => Boolean(tag));

const mapRequirements = (requirements: unknown[]): RequirementNode[] =>
  requirements
    .map((req) => {
      const id = toNumberId(getField(req, "id"));
      const title = getField<string>(req, "title");
      if (!id || !title) {
        return null;
      }
      const requirementKeyRaw = getField<string | number>(
        req,
        "requirement_key"
      );
      const requirementIdRaw = getField<string | number>(
        req,
        "requirement_id"
      );
      const requirement_key =
        requirementKeyRaw !== undefined && requirementKeyRaw !== null
          ? String(requirementKeyRaw)
          : undefined;
      const requirement_id =
        requirementIdRaw !== undefined && requirementIdRaw !== null
          ? String(requirementIdRaw)
          : undefined;
      return {
        id,
        title,
        ...(requirement_key ? { requirement_key } : {}),
        ...(requirement_id ? { requirement_id } : {}),
      };
    })
    .filter((req): req is RequirementNode => Boolean(req));

const mapProjectUsers = (projectUsers: unknown[]): ProjectUserNode[] => {
  const deduped = new Map<number, ProjectUserNode>();

  projectUsers.forEach((projectUser) => {
    const rawUser = getField<unknown>(projectUser, "user");
    const userObject =
      rawUser && typeof rawUser === "object"
        ? (rawUser as Record<string, unknown>)
        : undefined;

    const id =
      (userObject ? toNumberId(getField(userObject, "id")) : undefined) ??
      toNumberId(rawUser) ??
      toNumberId(getField(projectUser, "user_id")) ??
      toNumberId(getField(projectUser, "userId"));

    if (!id) {
      return;
    }

    const roleRaw = getField(projectUser, "role");
    const roleObject =
      roleRaw && typeof roleRaw === "object"
        ? (roleRaw as Record<string, unknown>)
        : undefined;

    const name =
      (userObject ? normalizeString(getField(userObject, "name")) : undefined) ??
      normalizeString(getField(projectUser, "name")) ??
      `User ${id}`;
    const email = userObject
      ? normalizeString(getField(userObject, "email"))
      : undefined;
    const username = userObject
      ? normalizeString(getField(userObject, "username"))
      : undefined;
    const role =
      (roleObject
        ? normalizeString(getField(roleObject, "name")) ??
          normalizeString(getField(roleObject, "title"))
        : undefined) ?? normalizeString(roleRaw);

    deduped.set(id, {
      id,
      name,
      ...(email ? { email } : {}),
      ...(username ? { username } : {}),
      ...(role ? { role } : {}),
    });
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }
    return a.id - b.id;
  });
};

const mapCustomFields = (customFields: unknown[]): CustomFieldNode[] =>
  customFields
    .map((field) => {
      const id = toNumberId(getField(field, "id"));
      const name = getField<string>(field, "name");
      if (!id || !name) {
        return null;
      }
      const label = getField<string>(field, "label");
      const fieldType =
        getField<string>(field, "field_type") ?? getField<string>(field, "type");
      const extra = getField<Record<string, unknown>>(field, "extra");
      const options = extractCustomFieldOptions(extra);
      const shouldIncludeOptions =
        fieldType === "dropdown" || fieldType === "multipleSelect";

      return {
        id,
        name,
        ...(label ? { label } : {}),
        ...(fieldType ? { field_type: fieldType } : {}),
        ...(shouldIncludeOptions
          ? { options: options ?? [] }
          : options
            ? { options }
            : {}),
      };
    })
    .filter((field): field is CustomFieldNode => Boolean(field));

export const buildSuiteTree = (suites: unknown[]): SuiteNode[] => {
  const nodes = new Map<number, SuiteNode>();
  const parentMap = new Map<number, number | null>();
  const sortOrderMap = new Map<number, number | undefined>();

  suites.forEach((suite) => {
    const id = toNumberId(getField(suite, "id"));
    if (!id) {
      return;
    }
    const title =
      getField<string>(suite, "title") ??
      getField<string>(suite, "name") ??
      `Suite ${id}`;
    const parentId =
      toNumberId(getField(suite, "parent_id")) ??
      toNumberId(getField(suite, "parentId"));
    const sortOrder =
      toNumberId(getField(suite, "sort_order")) ??
      toNumberId(getField(suite, "order"));

    nodes.set(id, {
      id,
      title,
      parent_id: parentId ?? null,
      children: [],
    });
    parentMap.set(id, parentId ?? null);
    sortOrderMap.set(id, sortOrder);
  });

  const roots: SuiteNode[] = [];

  for (const node of nodes.values()) {
    const parentId = parentMap.get(node.id);
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (list: SuiteNode[]) => {
    list.sort((a, b) => {
      const orderA = sortOrderMap.get(a.id);
      const orderB = sortOrderMap.get(b.id);
      if (orderA !== undefined && orderB !== undefined && orderA !== orderB) {
        return orderA - orderB;
      }
      if (orderA !== undefined && orderB === undefined) {
        return -1;
      }
      if (orderA === undefined && orderB !== undefined) {
        return 1;
      }
      return a.title.localeCompare(b.title);
    });
    list.forEach((child) => sortNodes(child.children));
  };

  sortNodes(roots);

  return roots;
};

export const clearProjectContextCache = (): void => {
  contextCache.clear();
};

export const getCachedProjectContext = (
  projectId: number
): ProjectContextPayload | null => {
  if (cacheTtlMs <= 0) {
    return null;
  }
  const cacheKey = getCacheKey(projectId);
  const cached = contextCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    contextCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
};

// ============================================================================
// Handler
// ============================================================================

export async function handleProjectContext(
  projectId: number
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  const now = Date.now();
  const cacheKey = cacheTtlMs > 0 ? getCacheKey(projectId) : undefined;

  if (cacheKey) {
    const cached = contextCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      console.log(
        `${logPrefix} Project context cache hit for project ${projectId}`
      );
      return {
        contents: [
          {
            uri: `testcollab://project/${projectId}/context`,
            mimeType: "application/json",
            text: JSON.stringify(cached.payload, null, 2),
          },
        ],
      };
    }
  }

  const startTime = Date.now();
  console.log(`${logPrefix} Building project context for ${projectId}`);

  try {
    const client = getApiClient();

    let companyId: number | undefined;
    try {
      console.log(
        `${apiLogPrefix} GET /projects/{id} params: ${JSON.stringify({
          projectId,
        })}`
      );
      const project = await client.getProject(projectId);
      companyId = getCompanyIdFromProject(project);
    } catch (error) {
      console.warn(
        `${logPrefix} Failed to fetch project ${projectId} for company ID`,
        error
      );
    }

    console.log(
      `${apiLogPrefix} GET /suites params: ${JSON.stringify({
        projectId,
      })}`
    );
    console.log(
      `${apiLogPrefix} GET /tags params: ${JSON.stringify({
        projectId,
        // companyId,
      })}`
    );
    console.log(
      `${apiLogPrefix} GET /requirements params: ${JSON.stringify({
        projectId,
        companyId,
      })}`
    );
    console.log(
      `${apiLogPrefix} GET /customfields params: ${JSON.stringify({
        projectId,
        companyId,
        entity: "TestCase",
      })}`
    );
    console.log(
      `${apiLogPrefix} GET /projectusers params: ${JSON.stringify({
        projectId,
      })}`
    );

    const [suitesList, tagsList, requirementsList, customFieldsList, projectUsersList] =
      await Promise.all([
        client.listSuites(projectId),
        client.listTags(projectId),
        client.listRequirements(projectId),
        client.listProjectCustomFields(projectId, companyId),
        client.listProjectUsers(projectId).catch((error) => {
          console.warn(
            `${logPrefix} Failed to fetch project users for ${projectId}`,
            error
          );
          return [];
        }),
      ]);

    const suites = buildSuiteTree(Array.isArray(suitesList) ? suitesList : []);
    const tags = mapTags(Array.isArray(tagsList) ? tagsList : []);
    const requirements = mapRequirements(
      Array.isArray(requirementsList) ? requirementsList : []
    );
    const custom_fields = mapCustomFields(
      Array.isArray(customFieldsList) ? customFieldsList : []
    );
    const users = mapProjectUsers(
      Array.isArray(projectUsersList) ? projectUsersList : []
    );

    const payload: ProjectContextPayload = {
      project_id: projectId,
      suites,
      tags,
      custom_fields,
      requirements,
      users,
    };

    if (cacheKey) {
      contextCache.set(cacheKey, {
        expiresAt: now + cacheTtlMs,
        payload,
      });
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `${logPrefix} Project context ready for ${projectId} in ${durationMs}ms (suites: ${suites.length}, tags: ${tags.length}, custom_fields: ${custom_fields.length}, requirements: ${requirements.length}, users: ${users.length})`
    );

    return {
      contents: [
        {
          uri: `testcollab://project/${projectId}/context`,
          mimeType: "application/json",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error(
      `${logPrefix} Failed to build project context for ${projectId}:`,
      error
    );

    return {
      contents: [
        {
          uri: `testcollab://project/${projectId}/context`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              error: "PROJECT_CONTEXT_FETCH_FAILED",
              message:
                error instanceof Error ? error.message : "Unknown error",
            },
            null,
            2
          ),
        },
      ],
    };
  }
}

// ============================================================================
// Resolve project ID (same logic as tools)
// ============================================================================

export function resolveProjectId(providedId?: number): number | undefined {
  if (providedId) return providedId;
  const requestContext = getRequestContext();
  if (requestContext?.defaultProjectId) return requestContext.defaultProjectId;
  try {
    const envConfig = getConfig();
    return envConfig.defaultProjectId;
  } catch {
    return undefined;
  }
}
