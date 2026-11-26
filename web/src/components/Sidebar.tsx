import { logout } from "../lib/auth";
import type { Route } from "../lib/route";
import type { Me } from "../lib/types";
import { Avatar } from "./ui";
import { Icon, type IconName } from "./Icon";
import { useMenu } from "./Menu";

export function Sidebar({ me, route, onEditProfile }: { me: Me; route: Route; onEditProfile: () => void }) {
  const openMenu = useMenu();
  const link = (view: Route["view"], href: string, icon: IconName, label: string) => (
    <a href={href} className={route.view === view ? "active" : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
    </a>
  );
  return (
    <nav id="side">
      <div className="brand"><img src="/logo.png" alt="" width={26} height={26} /><span>VDI File Share</span></div>
      <div className="nav">
        {link("files", "#/", "folder", "Files")}
        {link("trash", "#/trash", "trash", "Trash")}
        {me.isAdmin && link("members", "#/members", "users", "Members")}
      </div>
      <button className="me" aria-haspopup="menu" onClick={(e) => openMenu(e.currentTarget, [
        { label: "Edit profile", icon: "user", onClick: onEditProfile },
        { label: "Sign out", icon: "logout", onClick: logout },
      ])}>
        <Avatar name={me.displayName} email={me.email} size={28} />
        <span className="me-text">
          <strong>{me.displayName || me.email.split("@")[0]}</strong>
          <span>{me.email}</span>
        </span>
        <Icon name="chevronDown" className="caret" />
      </button>
    </nav>
  );
}
