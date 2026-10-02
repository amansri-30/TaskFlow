import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    maxLength: [120, "Task title cannot exceed 120 characters"],
  },
  description: {
    type: String,
    default: "",
    maxLength: [100, "Description cannot exceed 100 Characters"],
  },
  notes: {
    type: String,
    default: "",
    maxLength: [4000, "Notes cannot exceed 4000 characters"],
  },
  list: {
    type: String,
    default: "default",
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "medium",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
  },
  baseTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Task",
    default: null,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  scheduledAt: {
    type: Date,
    default: null,
  },
  remindAt: {
    type: Date,
    default: null,
  },
  remindedAt: {
    type: Date,
    default: null,
  },
  completed: {
    type: Boolean,
    default: false,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  recurrence: {
    type: String,
    enum: ["none", "daily", "weekly", "monthly"],
    default: "none",
  },
  tags: {
    type: [String],
    default: () => [],
  },
  subtasks: {
    type: [
      {
        text: { type: String, required: true, maxLength: 200 },
        completed: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: () => [],
  },
  monthlyDay: {
    type: Number,
    default: null,
  },
  trashed: {
    type: Boolean,
    default: false,
  },
  trashedAt: {
    type: Date,
    default: null,
  },
  pinned: {
    type: Boolean,
    default: false,
  },
});

// A recurring chain spawns its next occurrence by checking for an existing one
// and then inserting. Those two steps are not atomic, so two completions of the
// same task arriving together — a second tab, or a retried PATCH — both passed
// the check and both inserted, leaving the chain forked with a duplicate
// occurrence that the reopen cleanup then deletes as an "orphan".
//
// This index makes the invariant enforceable rather than merely intended: at
// most one non-trashed occurrence per (chain, due date). It is partial on
// `baseTaskId` being set, so ordinary hand-made tasks are unaffected and the
// many rows sharing a null `scheduledAt` never collide.
TaskSchema.index(
  { user: 1, baseTaskId: 1, scheduledAt: 1 },
  {
    unique: true,
    // Partial on both fields being set. `$type` rather than `$ne: null` so the
    // filter does not depend on query semantics that changed between MongoDB
    // versions. Ordinary tasks carry baseTaskId: null, and every dateless task
    // shares scheduledAt: null, so without the partial filter this unique index
    // would collide across a user's own unrelated rows.
    partialFilterExpression: {
      baseTaskId: { $type: "objectId" },
      scheduledAt: { $type: "date" },
    },
  }
);

const Task = mongoose.models.Task || mongoose.model("Task", TaskSchema);
export default Task;
