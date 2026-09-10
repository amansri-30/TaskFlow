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
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  scheduledAt: {
    type: Date,
    default: null,
  },
  completed: {
    type: Boolean,
    default: false,
  },
});

const Task = mongoose.models.Task || mongoose.model("Task", TaskSchema);
export default Task;
