import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { ago, extOf, fullDate, kindOf, personName } from "../lib/format";
import type { AnyNode } from "../lib/types";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  label?: string;
  icon?: IconName;
  kind?: "ghost" | "primary" | "danger" | "danger-solid";
  size?: "sm" | "xs" | "lg";
  /** Tooltip; also the accessible name for icon-only buttons. */
  title?: string;
};

export function Button({ label, icon, kind = "ghost", size, title, className = "", type = "button", ...rest }: ButtonProps) {
  const cls = ["btn", kind, size, label ? "" : "icon-only", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} title={title} aria-label={label ? undefined : title} {...rest}>
      {icon && <Icon name={icon} />}
      {label && <span>{label}</span>}
    </button>
  );
}

const AVATAR_COLORS = ["#e76f51", "#2a9d8f", "#8e7dbe", "#e9a23b", "#4d8fd6", "#d1608f", "#5a9e5a", "#c46b3c"];

export function Avatar({ name, email, size = 22 }: { name?: string; email?: string; size?: number }) {
  const label = (name || email || "?").trim();
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (name && parts[1] ? parts[1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of (email || label).toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="avatar" title={label} aria-hidden="true"
      style={{ ["--s" as string]: `${size}px`, background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}>
      {initials}
    </span>
  );
}

export function Person({ name, email }: { name?: string; email?: string }) {
  return (
    <span className="person">
      <Avatar name={name} email={email} />
      <span className="person-name">{personName(name, email)}</span>
    </span>
  );
}

export const Time = ({ value }: { value?: string }) =>
  value ? <time dateTime={value} title={fullDate(value)}>{ago(value)}</time> : null;

/** File-type tile: colour + short extension label. */
export function Tile({ node, size = "" }: { node: Pick<AnyNode, "type" | "name">; size?: "" | "sm" | "lg" }) {
  if (node.type === "folder") {
    return <span className={`tile folder ${size}`}><Icon name="folder" /></span>;
  }
  const ext = extOf(node.name);
  return <span className={`tile ${kindOf(node.name)} ${size}`}>{ext ? <b>{ext.slice(0, 4)}</b> : <Icon name="file" />}</span>;
}

export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

export function SkeletonList() {
  return (
    <div className="list">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="row-item sk-row" style={{ ["--d" as string]: `${i * 60}ms` }}>
          <span className="sk sk-tile" />
          <span className="sk sk-line" />
        </div>
      ))}
    </div>
  );
}

export function PageHead({ crumbs, title, sub, actions }: { crumbs?: ReactNode[]; title: ReactNode; sub?: string | null; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-title">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <Icon name="chevron" className="sep" />}
                {c}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      <div className="page-actions">{actions}</div>
    </header>
  );
}
