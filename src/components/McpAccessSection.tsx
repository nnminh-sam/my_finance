'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import {
  createApiKey,
  errorMessage,
  listApiKeys,
  revokeApiKey,
  type ApiKeyInfo,
} from '../services/auth';
import { EditorActions } from './ProfileSection';

interface Props {
  disabled: boolean;
  onCountChange?: (count: number) => void;
}

export function McpAccessSection({ disabled, onCountChange }: Props) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenScope, setTokenScope] = useState<'read' | 'write'>('write');
  const [expiresInDays, setExpiresInDays] = useState<string>('never');
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copiedField, setCopiedField] = useState<'endpoint' | 'secret' | 'config' | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const mounted = useRef(true);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const endpointUrl = `${origin}/api/mcp`;

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const loaded = await listApiKeys();
        if (!mounted.current) return;
        setKeys(loaded);
        onCountChange?.(loaded.length);
      } catch (failure) {
        if (!mounted.current) return;
        setError(errorMessage(failure));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [onCountChange]);

  const copyText = async (text: string, field: 'endpoint' | 'secret' | 'config') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => {
        if (mounted.current) setCopiedField(current => (current === field ? null : current));
      }, 2000);
    } catch {
      // Clipboard may be blocked; text remains selectable.
    }
  };

  const handleCreate = async () => {
    if (saving || disabled) return;
    const trimmed = tokenName.trim();
    if (!trimmed) {
      setError('Give the personal access token a name (1–100 characters).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const days = expiresInDays === 'never' ? null : Number(expiresInDays);
      const result = await createApiKey(trimmed, days, tokenScope);
      const next = [result.apiKey, ...keys];
      setKeys(next);
      onCountChange?.(next.length);
      setNewSecret({ name: result.apiKey.name, secret: result.secret });
      setAdding(false);
      setTokenName('');
      setTokenScope('write');
      setExpiresInDays('never');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (revokingId || disabled) return;
    setRevokingId(id);
    setError(null);
    try {
      await revokeApiKey(id);
      const next = keys.filter(item => item.id !== id);
      setKeys(next);
      onCountChange?.(next.length);
      setConfirmRevokeId(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRevokingId(null);
    }
  };

  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        'my-finance': {
          url: endpointUrl,
          headers: {
            Authorization: `Bearer ${newSecret?.secret ?? 'mf_pat_<your_token_here>'}`,
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <section className="profile-panel" aria-label="AI and MCP Server">
      <div className="profile-panel-head">
        <div>
          <h2>AI &amp; MCP Server</h2>
          <p>
            Connect external AI agents (Claude Desktop, Cursor, Antigravity, or custom MCP clients) to query analytics and manage spendings, incomes, and categories over Streamable HTTP.
          </p>
        </div>
        <div className="profile-panel-tools">
          {!adding && (
            <button
              type="button"
              className="profile-button profile-button-primary"
              disabled={disabled || saving}
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
            >
              <Plus size={16} aria-hidden="true" />
              Create token
            </button>
          )}
        </div>
      </div>

      <dl className="profile-card profile-rows">
        <div className="profile-row">
          <dt>MCP Endpoint</dt>
          <dd className="profile-mono">{endpointUrl}</dd>
          <button
            type="button"
            className="profile-button"
            onClick={() => {
              void copyText(endpointUrl, 'endpoint');
            }}
          >
            {copiedField === 'endpoint' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copiedField === 'endpoint' ? 'Copied' : 'Copy URL'}
          </button>
        </div>
        <div className="profile-row">
          <dt>Transport</dt>
          <dd>Streamable HTTP (JSON-RPC 2.0 POST / GET / DELETE)</dd>
          <span className="profile-pill">MCP 2025-03-26</span>
        </div>
        <div className="profile-row">
          <dt>Capabilities</dt>
          <dd>18 tools · 4 resources · 3 resource templates · 4 prompts</dd>
          <span className="profile-pill"><Bot size={13} aria-hidden="true" />Read &amp; Write</span>
        </div>
      </dl>

      {adding && (
        <form
          className="profile-card profile-form"
          style={{ padding: '20px' }}
          noValidate
          aria-label="Create personal access token"
          aria-busy={saving}
          onSubmit={event => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <fieldset disabled={saving || disabled}>
            <label>
              Token name
              <input
                type="text"
                value={tokenName}
                maxLength={100}
                autoFocus
                placeholder="e.g. Claude Desktop, Cursor, Antigravity"
                onChange={event => setTokenName(event.target.value)}
              />
            </label>
            <label>
              Permissions
              <select value={tokenScope} onChange={event => setTokenScope(event.target.value as 'read' | 'write')}>
                <option value="write">Read &amp; Write (full finance management)</option>
                <option value="read">Read only (analytics &amp; queries only)</option>
              </select>
            </label>
            <label>
              Expiration
              <select value={expiresInDays} onChange={event => setExpiresInDays(event.target.value)}>
                <option value="never">No expiration</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
          </fieldset>
          <EditorActions
            busy={saving}
            onCancel={() => {
              setAdding(false);
              setError(null);
            }}
          />
        </form>
      )}

      {newSecret && (
        <div className="profile-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }} role="status">
          <div>
            <strong>Personal access token created: {newSecret.name}</strong>
            <p className="profile-hint">Copy this secret now. For your security, it will not be shown again.</p>
          </div>
          <div className="profile-actions">
            <code className="profile-mono" style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--profile-sunken)', flex: 1, overflowWrap: 'anywhere' }}>
              {newSecret.secret}
            </code>
            <button
              type="button"
              className="profile-button profile-button-primary"
              onClick={() => {
                void copyText(newSecret.secret, 'secret');
              }}
            >
              {copiedField === 'secret' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copiedField === 'secret' ? 'Copied token' : 'Copy token'}
            </button>
          </div>
          <div>
            <p className="profile-hint" style={{ marginBottom: '6px' }}>Client configuration snippet (`mcp_config.json` / `claude_desktop_config.json`):</p>
            <pre className="profile-mono" style={{ padding: '12px', borderRadius: '6px', background: 'var(--profile-sunken)', overflowX: 'auto', margin: 0 }}>
              {configSnippet}
            </pre>
          </div>
          <div className="profile-actions">
            <button
              type="button"
              className="profile-button"
              onClick={() => {
                void copyText(configSnippet, 'config');
              }}
            >
              {copiedField === 'config' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copiedField === 'config' ? 'Copied config' : 'Copy MCP config JSON'}
            </button>
            <button type="button" className="profile-button" onClick={() => setNewSecret(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="profile-error">{error}</p>}

      {loading ? (
        <p className="profile-card profile-empty">Loading personal access tokens…</p>
      ) : keys.length === 0 ? (
        <p className="profile-card profile-empty">
          No personal access tokens yet. Create a token to let external AI agents authenticate with `{endpointUrl}`.
        </p>
      ) : (
        <ul className="profile-card profile-list" aria-label="Personal access tokens">
          {keys.map(item => (
            <li key={item.id} className="profile-list-item">
              <span className="profile-glyph" style={{ color: 'var(--primary)', background: 'var(--profile-soft)' }} aria-hidden="true">
                <KeyRound size={18} />
              </span>
              <div className="profile-list-main">
                <strong>{item.name}</strong>
                <span className="profile-meta">
                  <span className="profile-pill">{item.scope === 'read' ? 'Read only' : 'Read & Write'}</span>
                  <span className="profile-mono">{item.keyPrefix}</span>
                  <span>Created {new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span>
                    {item.lastUsedAt
                      ? `Last used ${new Date(item.lastUsedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : 'Never used'}
                  </span>
                  {item.expiresAt && (
                    <span>Expires {new Date(item.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  )}
                </span>
              </div>
              <div className="profile-row-actions">
                {confirmRevokeId === item.id ? (
                  <>
                    <button
                      type="button"
                      className="profile-button"
                      disabled={revokingId === item.id}
                      onClick={() => setConfirmRevokeId(null)}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="profile-button profile-button-danger"
                      disabled={revokingId === item.id || disabled}
                      onClick={() => {
                        void handleRevoke(item.id);
                      }}
                    >
                      {revokingId === item.id ? 'Revoking…' : 'Revoke token'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="profile-button profile-button-ghost profile-button-danger"
                    disabled={disabled || Boolean(revokingId)}
                    aria-label={`Revoke token ${item.name}`}
                    onClick={() => {
                      setError(null);
                      setConfirmRevokeId(item.id);
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
