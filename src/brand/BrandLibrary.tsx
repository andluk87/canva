import { useEffect, useRef, useState } from "react";
import { Plus, Palette, Upload, Trash2, Check } from "lucide-react";
import { api, json, type User } from "../api";
import { Modal } from "../ui";
import {
  BRAND_FONTS,
  brandSettings,
  type BrandSettings,
} from "../../shared/brand.mjs";
import type { BrandKit, BrandSummary } from "./api";
import "./brand.css";
const defaults = (): BrandSettings =>
  brandSettings({
    name: "Новый бренд",
    colors: ["#7048ed", "#1e2433", "#f7f5ff"],
    font: "Arial",
  });
export default function BrandLibrary({
  user,
  onUserChange,
  toast,
}: {
  user: User;
  onUserChange: (u: User) => void;
  toast: (s: string) => void;
}) {
  const [kits, setKits] = useState<BrandSummary[]>([]),
    [selected, setSelected] = useState<BrandKit | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<{
      id?: string;
      revision?: number;
      settings: BrandSettings;
    } | null>(null),
    [deleting, setDeleting] = useState(false);
  const request = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  async function load(preferred?: string) {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ kits: BrandSummary[] }>("/brand-kits");
      const id = preferred || user.brand.kitId || result.kits[0]?.id;
      const detail =
        id && result.kits.some((k) => k.id === id)
          ? await api<{ kit: BrandKit }>("/brand-kits/" + id)
          : null;
      if (!alive.current || ticket !== request.current) return;
      setKits(result.kits);
      setSelected(detail?.kit || null);
    } catch (e) {
      if (alive.current && ticket === request.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && ticket === request.current) setLoading(false);
    }
  }
  async function choose(id: string) {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      const { kit } = await api<{ kit: BrandKit }>("/brand-kits/" + id);
      if (alive.current && ticket === request.current) setSelected(kit);
    } catch (e) {
      if (alive.current && ticket === request.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && ticket === request.current) setLoading(false);
    }
  }
  async function mutate(operation: () => Promise<any>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      if (!alive.current) return;
      setEditing(null);
      setDeleting(false);
      await load(result?.kit?.id || selected?.id);
      if (!alive.current) return;
      const { user: next } = await api<{ user: User }>("/auth/me");
      if (!alive.current) return;
      onUserChange(next);
      toast(message);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!selected || !file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("revision", String(selected.revision));
    await mutate(
      () =>
        api("/brand-kits/" + selected.id + "/logos", {
          method: "POST",
          body: form,
        }),
      "Логотип добавлен",
    );
  }
  return (
    <section className="brand-library" aria-busy={busy || loading}>
      <span className="section-kicker">ВАШ УЗНАВАЕМЫЙ СТИЛЬ</span>
      <h1>Ваши бренды</h1>
      <p className="muted">
        Палитры, типографика и логотипы для разных проектов. Личная библиотека:
        до 20 брендов.
      </p>
      <div className="brand-actions">
        <button
          className="primary"
          disabled={busy || loading}
          onClick={() => setEditing({ settings: defaults() })}
        >
          <Plus size={17} />
          Создать бренд
        </button>
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => void load(selected?.id)}
        >
          Обновить библиотеку брендов
        </button>
        {user.brand.name && !user.brand.kitId && (
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => {
              let settings;
              try {
                settings = brandSettings({ ...defaults(), ...user.brand });
              } catch {
                settings = defaults();
              }
              setEditing({ settings });
            }}
          >
            Сохранить текущий стиль
          </button>
        )}
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Загружаем бренды…</p>}
      <div className="brand-library-layout">
        <nav className="brand-list" aria-label="Личные бренд-наборы">
          {kits.map((kit) => (
            <button
              key={kit.id}
              disabled={busy || loading}
              className={selected?.id === kit.id ? "selected" : ""}
              onClick={() => void choose(kit.id)}
            >
              <Palette size={18} />
              <span>
                <strong>{kit.name}</strong>
                <small>
                  {kit.font} · {kit.logoCount} логотипов
                  {user.brand.kitId === kit.id ? " · по умолчанию" : ""}
                </small>
                <span className="brand-chips">
                  {kit.colors.map((color, i) => (
                    <i key={i} style={{ background: color }} />
                  ))}
                </span>
              </span>
            </button>
          ))}
          {!loading && !kits.length && (
            <p className="muted">
              Создайте первый бренд или сохраните прежний стиль.
            </p>
          )}
        </nav>
        {selected && (
          <article className="brand-detail">
            <div className="brand-detail-title">
              <h2>{selected.name}</h2>
              <div className="brand-actions">
                <button
                  className="secondary"
                  disabled={busy || loading}
                  onClick={() =>
                    setEditing({
                      id: selected.id,
                      revision: selected.revision,
                      settings: brandSettings(selected),
                    })
                  }
                >
                  Редактировать бренд
                </button>
                <button
                  className="secondary"
                  disabled={busy || loading}
                  onClick={() => setDeleting(true)}
                >
                  Удалить бренд
                </button>
              </div>
            </div>
            <div
              className="brand-live-preview"
              style={{
                background: selected.colors[2] || "#f7f5ff",
                color: selected.colors[1] || selected.colors[0],
                fontFamily: selected.font,
              }}
            >
              <span style={{ color: selected.colors[0] }}>ВАШ СТИЛЬ</span>
              <h3
                style={{
                  fontSize: Math.min(selected.typography.headingSize, 56),
                  fontWeight: selected.typography.headingWeight,
                  lineHeight: selected.typography.lineHeight,
                }}
              >
                {selected.name}
              </h3>
              <p
                style={{
                  fontSize: Math.min(selected.typography.bodySize, 28),
                  fontWeight: selected.typography.bodyWeight,
                  lineHeight: selected.typography.lineHeight,
                }}
              >
                Узнаваемый дизайн начинается с деталей.
              </p>
            </div>
            <button
              className="primary"
              disabled={busy || loading || user.brand.kitId === selected.id}
              onClick={() =>
                void mutate(
                  () =>
                    api(
                      "/brand-kits/" + selected.id + "/activate",
                      json({ revision: selected.revision }),
                    ),
                  "Бренд выбран по умолчанию",
                )
              }
            >
              <Check size={17} />
              {user.brand.kitId === selected.id
                ? "Используется по умолчанию"
                : "Использовать по умолчанию"}
            </button>
            <h3>Логотипы</h3>
            <p className="muted small">
              PNG, JPG или WebP до 10 МиБ. Сохраняем PNG до 1200 px / 1 МиБ; до
              10 логотипов на бренд.
            </p>
            <label className="brand-upload">
              <Upload size={17} />
              Добавить логотип
              <input
                aria-label="Загрузить логотип бренда"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || loading || selected.logos.length >= 10}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="brand-logo-grid">
              {selected.logos.map((logo) => (
                <figure key={logo.id}>
                  <img src={logo.src} alt={logo.name} />
                  <figcaption>{logo.name}</figcaption>
                  <button
                    className="secondary"
                    disabled={busy || loading}
                    aria-label={"Удалить логотип " + logo.name}
                    onClick={() =>
                      void mutate(
                        () =>
                          api(
                            "/brand-kits/" + selected.id + "/logos/" + logo.id,
                            json({ revision: selected.revision }, "DELETE"),
                          ),
                        "Логотип удалён",
                      )
                    }
                  >
                    <Trash2 size={15} />
                    Удалить
                  </button>
                </figure>
              ))}
            </div>
            <p className="muted small">
              Изменения библиотеки не меняют уже созданные дизайны. Вставленные
              логотипы сохраняются внутри документа.
            </p>
          </article>
        )}
      </div>
      {editing && (
        <Modal
          title={editing.id ? "Редактировать бренд" : "Создать бренд"}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form
            className="brand-edit-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                () =>
                  api(
                    "/brand-kits" + (editing.id ? "/" + editing.id : ""),
                    json(
                      {
                        ...editing.settings,
                        ...(editing.id ? { revision: editing.revision } : {}),
                      },
                      editing.id ? "PUT" : "POST",
                    ),
                  ),
                "Бренд-набор сохранён",
              );
            }}
          >
            <label>
              Название бренда
              <input
                aria-label="Название бренда"
                value={editing.settings.name}
                maxLength={100}
                required
                disabled={busy}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    settings: { ...editing.settings, name: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Шрифт бренда
              <select
                aria-label="Шрифт бренда"
                disabled={busy}
                value={editing.settings.font}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    settings: { ...editing.settings, font: e.target.value },
                  })
                }
              >
                {BRAND_FONTS.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>
            <div className="brand-color-editor">
              {editing.settings.colors.map((color, index) => (
                <div key={index}>
                  <label>
                    Цвет {index + 1}
                    <input
                      aria-label={"Цвет бренда " + (index + 1)}
                      type="color"
                      value={color}
                      disabled={busy}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          settings: {
                            ...editing.settings,
                            colors: editing.settings.colors.map((old, i) =>
                              i === index ? e.target.value : old,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={"Убрать цвет " + (index + 1)}
                    disabled={busy || editing.settings.colors.length === 1}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        settings: {
                          ...editing.settings,
                          colors: editing.settings.colors.filter(
                            (_, i) => i !== index,
                          ),
                        },
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              disabled={busy || editing.settings.colors.length >= 10}
              onClick={() =>
                setEditing({
                  ...editing,
                  settings: {
                    ...editing.settings,
                    colors: [...editing.settings.colors, "#7048ed"],
                  },
                })
              }
            >
              Добавить цвет
            </button>
            {(["headingSize", "bodySize", "lineHeight"] as const).map((key) => (
              <label key={key}>
                {key === "headingSize"
                  ? "Размер заголовка"
                  : key === "bodySize"
                    ? "Размер основного текста"
                    : "Межстрочный интервал"}
                <input
                  aria-label={
                    key === "headingSize"
                      ? "Размер заголовка"
                      : key === "bodySize"
                        ? "Размер основного текста"
                        : "Межстрочный интервал"
                  }
                  type="number"
                  required
                  min={key === "lineHeight" ? 0.8 : 8}
                  max={key === "lineHeight" ? 2.5 : 200}
                  step={key === "lineHeight" ? 0.1 : 1}
                  disabled={busy}
                  value={editing.settings.typography[key]}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      settings: {
                        ...editing.settings,
                        typography: {
                          ...editing.settings.typography,
                          [key]: Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
            ))}
            {(["headingWeight", "bodyWeight"] as const).map((key) => (
              <label key={key}>
                {key === "headingWeight"
                  ? "Начертание заголовка"
                  : "Начертание основного текста"}
                <select
                  aria-label={
                    key === "headingWeight"
                      ? "Начертание заголовка"
                      : "Начертание основного текста"
                  }
                  disabled={busy}
                  value={editing.settings.typography[key]}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      settings: {
                        ...editing.settings,
                        typography: {
                          ...editing.settings.typography,
                          [key]: e.target.value,
                        },
                      },
                    })
                  }
                >
                  <option value="normal">Обычное</option>
                  <option value="bold">Жирное</option>
                </select>
              </label>
            ))}
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить бренд-набор"}
            </button>
          </form>
        </Modal>
      )}
      {deleting && selected && (
        <Modal
          title="Удалить бренд"
          onClose={() => {
            if (!busy) setDeleting(false);
          }}
        >
          <p>
            Удалить «{selected.name}» и его логотипы из библиотеки? Существующие
            дизайны сохранятся.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void mutate(
                () =>
                  api(
                    "/brand-kits/" + selected.id,
                    json({ revision: selected.revision }, "DELETE"),
                  ),
                "Бренд удалён",
              )
            }
          >
            Удалить бренд навсегда
          </button>
        </Modal>
      )}
    </section>
  );
}
