export interface Ancestor {
  id: string;
  name: string;
}

interface NodeBase {
  id: string;
  name: string;
  parentId: string;
  ancestors?: Ancestor[];
  status?: "active" | "pending" | "deleted";
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
}

export interface FolderNode extends NodeBase {
  type: "folder";
}

export interface FileNode extends NodeBase {
  type: "file";
  currentVersion: number;
  size: number;
  contentType?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}

export type AnyNode = FolderNode | FileNode;

export interface FolderContents {
  folder: FolderNode | null;
  breadcrumbs: Ancestor[];
  folders: FolderNode[];
  files: FileNode[];
}

export interface Version {
  version: number;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName?: string;
  originalName?: string;
  note?: string;
}

export interface Comment {
  sk: string;
  author: string;
  authorName?: string;
  createdAt: string;
  version?: number | null;
  text: string;
  editedAt?: string;
}

export interface FileDetail {
  file: FileNode;
  versions: Version[];
  comments: Comment[];
}

export type TrashItem = AnyNode & {
  deletedAt: string;
  deletedBy: string;
  deletedByName?: string;
};

export interface Me {
  email: string;
  name?: string;
  displayName?: string;
  isAdmin: boolean;
  role?: "admin" | "member";
  owner?: boolean;
}

export interface Member {
  email: string;
  displayName?: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  owner?: boolean;
}
