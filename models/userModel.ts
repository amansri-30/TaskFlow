import mongoose from 'mongoose';
import isEmail from 'validator/lib/isEmail';

const UserSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        validate: isEmail
    },
    password: {
        type: String,
        required: true,
        minLength: [10, 'Password must be atleast 10 Characters'],
        select: false
    },
    resetPasswordToken: {
        type: String,
        select: false,
    },
    resetPasswordExpire: {
        type: Date,
    },
    passwordChangedAt: {
        type: Date,
        default: null,
    },
    // Failed sign-ins since the last success. Kept on the document rather than
    // in process memory so the lockout survives a restart and holds across every
    // instance behind a load balancer -- an in-memory counter would be reset by
    // each new server, making it useless exactly when it is needed.
    loginAttempts: {
        type: Number,
        default: 0,
        select: false,
    },
    // While this is in the future, password sign-in is refused regardless of the
    // password. Cleared on the next successful sign-in.
    lockedUntil: {
        type: Date,
        default: null,
    },
    createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    }
);

const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;
