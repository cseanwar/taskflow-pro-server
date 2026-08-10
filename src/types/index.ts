import { ObjectId } from 'mongodb';

export type UserRole = 'Administrator' | 'Workspace Owner' | 'Project Manager' | 'Team Member' | 'Guest User';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type SprintStatus = 'Planned' | 'Active' | 'Completed';

export interface IUser {
  _id?: ObjectId | string;
  name: string;
  email: string;
  password?: string;
  avatar?: string;
  role: UserRole;
  isVerified?: boolean;
  status: 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
}

export interface IWorkspaceMember {
  userId: ObjectId | string;
  role: UserRole;
  joinedAt: Date;
}

export interface IWorkspace {
  _id?: ObjectId | string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  ownerId: ObjectId | string;
  members: IWorkspaceMember[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IProject {
  _id?: ObjectId | string;
  workspaceId: ObjectId | string;
  name: string;
  code: string; // Key e.g., "TF"
  description?: string;
  category?: string;
  status: 'active' | 'archived';
  managerId: ObjectId | string;
  members: (ObjectId | string)[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IColumn {
  id: string; // e.g. "backlog", "todo", "in_progress", "review", "testing", "done"
  title: string;
  order: number;
}

export interface IBoard {
  _id?: ObjectId | string;
  projectId: ObjectId | string;
  name: string;
  columns: IColumn[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface ITaskAttachment {
  id: string;
  name: string;
  url: string;
  uploadedAt: Date;
}

export interface ITask {
  _id?: ObjectId | string;
  projectId: ObjectId | string;
  columnId: string;
  sprintId?: ObjectId | string | null;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: Date | string | null;
  assigneeIds: (ObjectId | string)[];
  reporterId: ObjectId | string;
  labels: string[];
  attachments?: ITaskAttachment[];
  checklist?: IChecklistItem[];
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISprint {
  _id?: ObjectId | string;
  projectId: ObjectId | string;
  name: string;
  goal?: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  status: SprintStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComment {
  _id?: ObjectId | string;
  taskId: ObjectId | string;
  authorId: ObjectId | string;
  text: string;
  attachments?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface INotification {
  _id?: ObjectId | string;
  userId: ObjectId | string;
  type: 'assignment' | 'task_update' | 'due_date' | 'comment' | 'invitation';
  title: string;
  message: string;
  read: boolean;
  link?: string;
  createdAt: Date;
}

export interface ILabel {
  _id?: ObjectId | string;
  workspaceId: ObjectId | string;
  name: string;
  color: string;
}

export interface IActivityLog {
  _id?: ObjectId | string;
  workspaceId: ObjectId | string;
  projectId?: ObjectId | string;
  taskId?: ObjectId | string;
  actorId: ObjectId | string;
  action: string;
  details?: string;
  createdAt: Date;
}

export interface IInvitation {
  _id?: ObjectId | string;
  workspaceId: ObjectId | string;
  email: string;
  role: UserRole;
  token: string;
  invitedBy: ObjectId | string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Date;
}
