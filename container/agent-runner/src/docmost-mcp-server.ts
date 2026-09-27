/**
 * MCP Server for Docmost Wiki
 *
 * Komunikuje sie z docmost-gtw gateway (REST API) i udostepnia
 * toole do zarzadzania stronami, spaces i trescia w Docmost.
 *
 * Transport: stdio (standard for Claude Desktop / Claude Code)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Gateway HTTP helper
// ---------------------------------------------------------------------------

const GTW_URL = process.env.DOCMOST_GTW_URL || 'http://localhost:8090';
const GTW_API_KEY = process.env.DOCMOST_GTW_API_KEY || '';
const USER_API_KEY = process.env.DOCMOST_USER_API_KEY || '';

if (!GTW_API_KEY) {
  console.warn('[docmost-mcp-server] WARNING: DOCMOST_GTW_API_KEY is not set. Requests to GTW will be rejected.');
}
if (USER_API_KEY) {
  console.warn('[docmost-mcp-server] INFO: DOCMOST_USER_API_KEY set, using per-user identity.');
}

async function gtwFetch(path: string, options?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-GTW-Api-Key': GTW_API_KEY,
    'X-Service-Name': 'mcp-server',
  };
  if (USER_API_KEY) {
    headers['Authorization'] = `Bearer ${USER_API_KEY}`;
  }

  const res = await fetch(`${GTW_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers as Record<string, string>,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gateway ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Helper: build MCP response
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'docmost',
  version: '0.1.0',
});

// ── 1. docmost_list_spaces ───────────────────────────────────────────────

server.tool(
  'docmost_list_spaces',
  'Lista wszystkich spaces (przestrzeni) w Docmost. Zwraca nazwe, slug, id i opis kazdego space.',
  {},
  async () => {
    try {
      const data = await gtwFetch('/v1/spaces');
      const spaces = (data.items || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description || null,
      }));
      return ok({ spaces, total: spaces.length });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 2. docmost_list_pages ────────────────────────────────────────────────

server.tool(
  'docmost_list_pages',
  'Lista stron w danym space (drzewo sidebaru). Podaj slug lub ID space. Opcjonalnie parent_page_id zeby pobrac podstrony.',
  {
    space: z
      .string()
      .describe('Slug lub UUID space (np. "projects", "engineering")'),
    parent_page_id: z
      .string()
      .optional()
      .describe('ID strony-rodzica (UUID lub slugId) — jesli podane, zwraca podstrony'),
  },
  async ({ space, parent_page_id }) => {
    try {
      let path: string;
      if (parent_page_id) {
        path = `/v1/spaces/${encodeURIComponent(space)}/sidebar-pages/${encodeURIComponent(parent_page_id)}/children`;
      } else {
        path = `/v1/spaces/${encodeURIComponent(space)}/sidebar-pages`;
      }
      const data = await gtwFetch(path);
      const pages = (data.items || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        slugId: p.slugId,
        icon: p.icon || null,
        hasChildren: p.hasChildren ?? false,
        parentPageId: p.parentPageId || null,
      }));
      return ok({ space, parentPageId: parent_page_id || null, pages, total: pages.length });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 3. docmost_get_page ──────────────────────────────────────────────────

server.tool(
  'docmost_get_page',
  'Pobranie metadanych strony z Docmost (tytul, slug, space, daty, rodzic). Podaj UUID lub slugId strony.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony (np. "OM3058xezY" lub UUID)'),
  },
  async ({ page_id }) => {
    try {
      const data = await gtwFetch(`/v1/pages/${encodeURIComponent(page_id)}`);
      const page = data.data || data;
      return ok({
        id: page.id,
        title: page.title,
        slugId: page.slugId,
        icon: page.icon || null,
        spaceId: page.spaceId,
        parentPageId: page.parentPageId || null,
        creatorId: page.creatorId,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 4. docmost_read_content ──────────────────────────────────────────────

server.tool(
  'docmost_read_content',
  'Odczyt tresci strony Docmost w formacie markdown. Podaj UUID lub slugId strony.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony'),
  },
  async ({ page_id }) => {
    try {
      const data = await gtwFetch(
        `/v1/pages/${encodeURIComponent(page_id)}/export?format=markdown`,
      );
      return ok({
        pageId: page_id,
        format: 'markdown',
        content: data.content || '',
      });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 5. docmost_create_page ───────────────────────────────────────────────

server.tool(
  'docmost_create_page',
  'Stworzenie nowej strony w Docmost z trescia markdown. Uzywa importu markdown przez gateway.',
  {
    space: z
      .string()
      .describe('Slug space (np. "projects")'),
    title: z
      .string()
      .describe('Tytul strony'),
    content: z
      .string()
      .describe('Tresc strony w formacie markdown'),
    parent_page_id: z
      .string()
      .optional()
      .describe('UUID lub slugId strony-rodzica (opcjonalnie, dla podstron)'),
  },
  async ({ space, title, content, parent_page_id }) => {
    try {
      let mdContent = content;
      if (!content.trimStart().startsWith('# ')) {
        mdContent = `# ${title}\n\n${content}`;
      }

      const body: Record<string, unknown> = {
        spaceRef: space,
        format: 'markdown',
        content: mdContent,
      };
      if (parent_page_id) {
        body.parentPageId = parent_page_id;
      }

      const data = await gtwFetch('/v1/pages/import', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return ok({
        created: true,
        pageId: data.pageId || data.pageUuid,
        pageUuid: data.pageUuid,
        space,
      });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 6. docmost_update_content ────────────────────────────────────────────

server.tool(
  'docmost_update_content',
  'Nadpisanie tresci istniejacej strony w Docmost nowym markdownem. Strategia: in-place update via ProseMirror JSON (WebSocket). Zachowuje page ID, slugId, children, komentarze.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony do zaktualizowania'),
    content: z
      .string()
      .describe('Nowa tresc w formacie markdown (nadpisze istniejaca)'),
    title: z
      .string()
      .optional()
      .describe('Nowy tytul (jesli pominiety, zachowa stary)'),
  },
  async ({ page_id, content, title }) => {
    let tempPageId: string | null = null;
    try {
      const pageData = await gtwFetch(`/v1/pages/${encodeURIComponent(page_id)}`);
      const page = pageData.data || pageData;
      const pageTitle = title || page.title || 'Untitled';

      let mdContent = content;
      if (!content.trimStart().startsWith('# ')) {
        mdContent = `# ${pageTitle}\n\n${content}`;
      }

      const imported = await gtwFetch('/v1/pages/import', {
        method: 'POST',
        body: JSON.stringify({
          spaceRef: 'trash',
          format: 'markdown',
          content: mdContent,
        }),
      });
      tempPageId = imported.pageUuid || imported.pageId;

      const tempContent = await gtwFetch(
        `/v1/pages/${encodeURIComponent(tempPageId!)}/content?format=docmost_prosemirror_json`,
      );

      await gtwFetch(`/v1/pages/${encodeURIComponent(page.id)}/content`, {
        method: 'PUT',
        body: JSON.stringify({
          format: 'docmost_prosemirror_json',
          content: tempContent.content,
          schemaVersion: 'v1',
        }),
      });

      if (title && title !== page.title) {
        await gtwFetch(`/v1/pages/${encodeURIComponent(page.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title }),
        });
      }

      await gtwFetch(`/v1/pages/${encodeURIComponent(tempPageId!)}`, { method: 'DELETE' });
      tempPageId = null;

      return ok({
        updated: true,
        pageId: page.slugId || page_id,
        pageUuid: page.id,
        title: pageTitle,
        spaceId: page.spaceId,
        note: 'Content updated in-place. Page ID, slugId, children preserved.',
      });
    } catch (e) {
      if (tempPageId) {
        try {
          await gtwFetch(`/v1/pages/${encodeURIComponent(tempPageId)}`, { method: 'DELETE' });
        } catch { /* ignore cleanup errors */ }
      }
      return err(e);
    }
  },
);

// ── 7. docmost_delete_page ───────────────────────────────────────────────

server.tool(
  'docmost_delete_page',
  'Usuniecie strony z Docmost. UWAGA: operacja nieodwracalna. Podaj UUID lub slugId strony.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony do usuniecia'),
  },
  async ({ page_id }) => {
    try {
      const data = await gtwFetch(`/v1/pages/${encodeURIComponent(page_id)}`, {
        method: 'DELETE',
      });
      return ok({ deleted: true, pageId: page_id, ...data });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 8. docmost_get_comments ──────────────────────────────────────────────

server.tool(
  'docmost_get_comments',
  'Lista komentarzy na stronie Docmost. Podaj UUID lub slugId strony.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony'),
  },
  async ({ page_id }) => {
    try {
      const data = await gtwFetch(`/v1/pages/${encodeURIComponent(page_id)}/comments`);
      return ok({
        pageId: page_id,
        comments: data.items || [],
        total: (data.items || []).length,
      });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 9. docmost_add_comment ───────────────────────────────────────────────

server.tool(
  'docmost_add_comment',
  'Dodanie komentarza do strony Docmost. Podaj page_id i tresc komentarza.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony'),
    comment: z
      .string()
      .describe('Tresc komentarza (plain text)'),
  },
  async ({ page_id, comment }) => {
    try {
      const prosemirrorContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: comment,
              },
            ],
          },
        ],
      };

      const data = await gtwFetch(`/v1/pages/${encodeURIComponent(page_id)}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          content: prosemirrorContent,
        }),
      });
      return ok({ created: true, pageId: page_id, comment: data.data || data });
    } catch (e) {
      return err(e);
    }
  },
);

// ── 10. docmost_update_page ──────────────────────────────────────────────

server.tool(
  'docmost_update_page',
  'Aktualizacja metadanych strony (tytul, rodzic, pozycja). Nie zmienia tresci — do tego uzyj docmost_update_content.',
  {
    page_id: z
      .string()
      .describe('UUID lub slugId strony'),
    title: z
      .string()
      .optional()
      .describe('Nowy tytul strony'),
    parent_page_id: z
      .string()
      .nullable()
      .optional()
      .describe('Nowy rodzic (null = przenies do roota)'),
    space_id: z
      .string()
      .optional()
      .describe('Nowy space ID (przeniesienie miedzy spaces)'),
  },
  async ({ page_id, title, parent_page_id, space_id }) => {
    try {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (parent_page_id !== undefined) body.parentPageId = parent_page_id;
      if (space_id !== undefined) body.spaceId = space_id;

      const data = await gtwFetch(`/v1/pages/${encodeURIComponent(page_id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return ok({ updated: true, pageId: page_id, ...data });
    } catch (e) {
      return err(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server failed to start:', error);
  process.exit(1);
});
