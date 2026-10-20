import { useEffect, useRef, useState } from "react";
import { api, type User } from "../api";
import { brandSettings, type BrandSettings } from "../../shared/brand.mjs";
import type { BrandKit, BrandLogo, BrandSummary } from "./api";
import "./brand.css";
export default function BrandPanel({
  user,
  readOnly,
  hasSelection,
  onApply,
  onLogo,
}: {
  user: User;
  readOnly: boolean;
  hasSelection: boolean;
  onApply: (
    brand: BrandSettings,
    options: { selection: boolean; typography: boolean; background: boolean },
  ) => void;
  onLogo: (logo: BrandLogo) => Promise<void>;
}) {
  const [kits, setKits] = useState<BrandSummary[]>([]),
    [kit, setKit] = useState<BrandKit | null>(null),
    [id, setId] = useState(user.brand.kitId || ""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const [typography, setTypography] = useState(false),
    [background, setBackground] = useState(false),
    [inserting, setInserting] = useState(false);
  const ticket = useRef(0);
  useEffect(() => {
    const request = ++ticket.current;
    setLoading(true);
    setKit(null);
    setError("");
    void api<{ kits: BrandSummary[] }>("/brand-kits")
      .then(async (result) => {
        const chosen = id && result.kits.some((k) => k.id === id) ? id : "";
        const detail = chosen
          ? await api<{ kit: BrandKit }>("/brand-kits/" + chosen)
          : null;
        if (ticket.current !== request) return;
        setKits(result.kits);
        setKit(detail?.kit || null);
        if (chosen !== id) setId(chosen);
      })
      .catch((e) => {
        if (ticket.current === request) setError(e.message);
      })
      .finally(() => {
        if (ticket.current === request) setLoading(false);
      });
    return () => {
      ticket.current++;
    };
  }, [id, reload]);
  let legacy: BrandSettings;
  try {
    legacy = brandSettings({
      name: user.brand.name || "Текущий стиль",
      colors: user.brand.colors?.length
        ? user.brand.colors
        : ["#7048ed", "#1e2433", "#f7f5ff"],
      font: user.brand.font || "Arial",
      typography: user.brand.typography,
    });
  } catch {
    legacy = brandSettings({
      name: "Текущий стиль",
      colors: ["#7048ed", "#1e2433", "#f7f5ff"],
      font: "Arial",
    });
  }
  const brand = kit || legacy;
  async function insert(logo: BrandLogo) {
    const request = ticket.current;
    setInserting(true);
    setError("");
    try {
      await onLogo(logo);
    } catch (e) {
      if (ticket.current === request) setError((e as Error).message);
    } finally {
      if (ticket.current === request) setInserting(false);
    }
  }
  return (
    <div className="brand-editor-panel" aria-busy={loading || inserting}>
      <p className="muted small">
        Выберите личный бренд. Изменение библиотеки не меняет дизайн
        автоматически.
      </p>
      <label>
        Бренд дизайна
        <select
          aria-label="Бренд дизайна"
          disabled={loading || inserting}
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">Текущий стиль аккаунта</option>
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary full"
        disabled={loading || inserting}
        onClick={() => setReload((n) => n + 1)}
      >
        Обновить бренды
      </button>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {loading && <p role="status">Загружаем бренды…</p>}
      <strong>{brand.name}</strong>
      <span className="brand-chips">
        {brand.colors.map((color, i) => (
          <i key={i} title={color} style={{ background: color }} />
        ))}
      </span>
      <p className="muted small">
        {brand.font} · заголовок {brand.typography.headingSize} px · текст{" "}
        {brand.typography.bodySize} px
      </p>
      <label className="brand-check">
        <input
          type="checkbox"
          aria-label="Применять размеры и начертания бренда"
          checked={typography}
          disabled={readOnly || loading || inserting || !!error}
          onChange={(e) => setTypography(e.target.checked)}
        />
        Размеры и начертания текста
      </label>
      <label className="brand-check">
        <input
          type="checkbox"
          aria-label="Применять фон бренда"
          checked={background}
          disabled={readOnly || loading || inserting || !!error}
          onChange={(e) => setBackground(e.target.checked)}
        />
        Цвет фона страницы
      </label>
      <button
        className="primary full"
        disabled={readOnly || loading || inserting || !!error}
        onClick={() =>
          onApply(brand, { selection: false, typography, background })
        }
      >
        Применить бренд к странице
      </button>
      <button
        className="secondary full"
        disabled={readOnly || loading || inserting || !!error || !hasSelection}
        onClick={() =>
          onApply(brand, { selection: true, typography, background: false })
        }
      >
        Применить бренд к выделению
      </button>
      <p className="muted small">
        Изображения, заблокированные объекты и диаграммы/таблицы сохраняют
        оформление. Обычные группы обрабатываются внутри. Текст от 32 px
        считается заголовком; меньший — основным. Одно применение — одно
        действие Undo.
      </p>
      <h4>Логотипы</h4>
      {!kit?.logos.length && (
        <p className="muted small">
          Добавьте логотипы в разделе «Бренд» на главной.
        </p>
      )}
      <div className="brand-editor-logos">
        {kit?.logos.map((logo) => (
          <button
            key={logo.id}
            className="brand-logo-button"
            disabled={readOnly || loading || inserting || !!error}
            aria-label={"Вставить логотип " + logo.name}
            onClick={() => void insert(logo)}
          >
            <img src={logo.src} alt="" />
            <span>{logo.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
