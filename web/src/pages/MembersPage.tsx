import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { qk, usersQuery } from "../lib/queries";
import type { Me, Member } from "../lib/types";
import { Avatar, Button, EmptyState, PageHead, SkeletonList } from "../components/ui";
import { useDialogs } from "../components/Dialogs";
import { useFail, useToast } from "../components/Toast";

export function MembersPage({ me }: { me: Me }) {
  const { data, error } = useQuery(usersQuery);
  const qc = useQueryClient();
  const dialogs = useDialogs();
  const toast = useToast();
  const fail = useFail();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("member");

  const refresh = () => qc.invalidateQueries({ queryKey: qk.users });

  async function invite(e: FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/invites", { email: email.trim(), role });
      toast(`Invitation sent to ${email.trim().toLowerCase()}`);
      setEmail("");
      await refresh();
    } catch (err) { fail(err); }
  }

  async function change(u: Member, patch: Partial<Pick<Member, "role" | "status">>) {
    try {
      await api("PUT", `/users/${encodeURIComponent(u.email)}`, patch);
      toast("Saved");
    } catch (e) { fail(e); }
    await refresh();
  }

  async function removeAccess(u: Member) {
    if (!await dialogs.confirm(`${u.displayName || u.email} will be signed out right away and won't be able to sign in. You can restore them later.`,
      { title: "Remove access?", ok: "Remove access", danger: true })) return;
    await change(u, { status: "disabled" });
  }

  if (!data) {
    return error
      ? <EmptyState icon="alert" title="Couldn't load members" text={error.message} />
      : <><PageHead title="Members" /><SkeletonList /></>;
  }
  const active = data.users.filter((u) => u.status === "active").length;

  return (
    <>
      <PageHead title="Members" sub={`${active} active · administrators can invite people, change roles and remove access`} />
      <form className="invite" onSubmit={invite}>
        <input className="input" type="email" required placeholder="name@example.com" aria-label="Email to invite" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="input" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Member["role"])}>
          <option value="member">Member</option>
          <option value="admin">Administrator</option>
        </select>
        <Button label="Send invite" icon="user" kind="primary" type="submit" />
      </form>
      <div className="list members">
        {data.users.map((u) => {
          const locked = !!u.owner || u.email.toLowerCase() === me.email.toLowerCase();
          const off = u.status !== "active";
          return (
            <div key={u.email} className={`row-item static${off ? " off" : ""}`}>
              <span className="cell-name">
                <Avatar name={u.displayName} email={u.email} size={32} />
                <span className="name-wrap">
                  <span className="name">{u.displayName || u.email.split("@")[0]}</span>
                  <span className="sub always">{u.email}</span>
                </span>
              </span>
              <span className="cell-meta">
                {locked ? (
                  <span className="role">Administrator<span className="chip muted">{u.owner ? "owner" : "you"}</span></span>
                ) : (
                  <select className="input sm" aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => change(u, { role: e.target.value as Member["role"] })}>
                    <option value="member">Member</option>
                    <option value="admin">Administrator</option>
                  </select>
                )}
              </span>
              <span className="cell-meta">
                {off ? <span className="chip danger">Access removed</span> : <span className="status"><i />Active</span>}
              </span>
              <span className="cell-act show">
                {!locked && (off
                  ? <Button label="Restore" icon="restore" size="sm" onClick={() => change(u, { status: "active" })} />
                  : <Button label="Remove" size="sm" kind="danger" onClick={() => removeAccess(u)} />)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
