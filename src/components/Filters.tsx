"use client";

import { STATUS_PREFIXES } from "@/lib/status";
import { statusLabel, t, type Lang } from "@/lib/i18n";

export type FilterState = {
  status: string;
  company: string;
  from: string;
  to: string;
  cv: string;
};

export function Filters({
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  value: FilterState;
  onChange: (v: FilterState) => void;
}) {
  return (
    <form
      className="filters"
      onSubmit={(e) => e.preventDefault()}
      aria-label={t(lang, "filters")}
    >
      <label>
        <span>{t(lang, "status")}</span>
        <select
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
        >
          <option value="">{t(lang, "all")}</option>
          {STATUS_PREFIXES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(lang, s)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t(lang, "company")}</span>
        <input
          type="search"
          placeholder={t(lang, "search")}
          value={value.company}
          onChange={(e) => onChange({ ...value, company: e.target.value })}
        />
      </label>
      <label>
        <span>{t(lang, "from")}</span>
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </label>
      <label>
        <span>{t(lang, "to")}</span>
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </label>
      <label>
        <span>{t(lang, "cv")}</span>
        <select
          value={value.cv}
          onChange={(e) => onChange({ ...value, cv: e.target.value })}
        >
          <option value="">{t(lang, "all")}</option>
          <option value="EN">EN</option>
          <option value="ES">ES</option>
          <option value="ES/EN">ES/EN</option>
        </select>
      </label>
    </form>
  );
}
