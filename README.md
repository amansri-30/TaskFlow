![TaskFlow Banner](./public/images/TaskFlow%20Banner.png)

# TaskFlow (To-Do List)

## Description

TaskFlow is a powerful and intuitive web application designed to help users manage and organize their tasks efficiently. It provides a clean, responsive interface to add, view, edit, and track to-do items — keeping your workflow organized and boosting productivity.

## Screenshots

Explore TaskFlow's clean and intuitive UI!

### Home Page

![TaskFlow Home](https://res.cloudinary.com/dnytagac4/image/upload/v1742026378/TaskFlow_Homepage_w31rzr.png)

### Task Management Dashboard

#### Light Mode

![TaskFlow Dashboard](https://res.cloudinary.com/dnytagac4/image/upload/v1742026378/TaskFlow_Dashboard_wgifsl.png)

#### Dark Mode

![TaskFlow Dashboard Dark](https://res.cloudinary.com/dnytagac4/image/upload/v1742026378/TaskFlow_Dashboard_Dark_kbrkdt.png)

## Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [System Design](#-system-design)
- [Setup Instructions](#%EF%B8%8F-setup-instructions)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Scripts](#-scripts)
- [Project Structure](#-project-structure)
- [Acknowledgments](#-acknowledgments)
- [License](#-license)
- [Contribution Guidelines](#-contribution-guidelines)

## Features

- **User Authentication:** Secure signup, login, and logout using JWT with httpOnly cookies.
- **Add Tasks:** Create tasks with a title, description, due date, and list.
- **View Tasks:** Display all tasks for the logged-in user, fetched from MongoDB.
- **Edit Tasks:** Modify the details of existing tasks via an inline dialog.
- **Delete Tasks:** Remove tasks that are no longer needed.
- **Route Protection:** Dashboard is protected behind authentication via middleware.
- **Dark / Light Mode:** Full theme switching via `next-themes`.
- **Responsive Design:** Optimized for both desktop and mobile devices, including a mobile slide-out sidebar.
- **Animated Landing Page:** Particle effects, vortex canvas, bento grid, and scroll-linked animations.

## Tech Stack

- **Frontend:** JavaScript, TypeScript, Next.js, Tailwind CSS, SCSS
- **State Management:** Redux Toolkit + redux-persist
- **UI Library:** shadcn/ui (Radix primitives)
- **Backend:** Next.js API Routes (Node.js), Mongoose
- **Database:** MongoDB (MongoDB Atlas)
- **Animations:** Framer Motion, tsparticles, Lottie

## System Design

```
TaskFlow/
├── App Router (Next.js 14)          # Pages: landing, dashboard, auth, info pages
│   └── Routes                        # 12 page routes
├── Pages Router API (Hybrid)         # Backend /api routes
│   ├── /api/auth/*                   # Register, Login, Logout
│   ├── /api/profile                  # User profile
│   ├── /api/getalltasks              # List tasks (DB + auth)
│   ├── /api/newtask                  # Create task
│   ├── /api/task/[id]                # Get, update, delete a single task
│   ├── /api/quotes                   # Inspirational quotes (server-side proxy)
│   └── /api/aboutme                  # About data
├── State Management                  # Redux Toolkit + persist (auth state)
├── Database                          # MongoDB via Mongoose (User, Task, Data)
├── UI Framework                      # shadcn/ui + Tailwind + custom elements
└── Animations                        # Framer Motion, tsparticles, Lottie
```

## Setup Instructions

### Prerequisites

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/)
- [MongoDB](https://www.mongodb.com/) (local or MongoDB Atlas)

### Installation

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/amansri-30/TaskFlow.git
   ```

2. **Navigate to Repository:**
   ```bash
   cd TaskFlow
   ```

3. **Install Node Modules:**
   ```bash
   npm install
   ```

4. **Setup Environment Variables:**
   Copy the `.env.example` file to `.env` (or `.env.local`) and fill in the values:
   ```bash
   cp .env.example .env.local
   ```
   ```plaintext
   MONGODB_URI=mongodb://localhost:27017/taskflow
   JWT_SECRET=<randomString>
   NEXT_PUBLIC_API_URL=
   QUOTES_API_KEY=<your-api-ninjas-key>
   ```

5. **Run the project in Development:**
   ```bash
   npm run dev
   ```

6. **Access the Application:**
   Open your browser and navigate to [http://localhost:3000](http://localhost:3000).

## Scripts

| Command            | Description                       |
| ------------------ | --------------------------------- |
| `npm run dev`      | Start the development server      |
| `npm run build`    | Create an optimized production build |
| `npm start`        | Start the production server       |
| `npm run lint`     | Run ESLint                        |

## Project Structure

```
TaskFlow/
├── app/                     # Next.js App Router pages & layouts
├── components/
│   ├── Dashboard/           # Dashboard UI (sidebar, task list, dialogs)
│   ├── Home/                # Landing page sections
│   ├── elements/            # Shared UI elements
│   └── ui/                  # shadcn/ui components
├── context/                 # React context providers
├── models/                  # Mongoose schemas (User, Task, Data)
├── pages/api/               # Backend API routes
├── redux/                   # Redux store, slices, provider
├── middleware/              # Auth helpers, response handlers, error catcher
├── lib/                     # Utilities and configuration
├── public/                  # Static assets (images, SVG icons, Lottie)
└── styles/                  # Global SCSS
```

## Acknowledgments

- [Next.js](https://nextjs.org/) for the Frontend Framework
- [React](https://react.dev/) for the Frontend Framework
- [MongoDB](https://www.mongodb.com/) for the database management system
- [Node.js](https://nodejs.org/) for the JavaScript runtime
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [shadcn/ui](https://ui.shadcn.com/) for the component library

## License

This project is released under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)** license. For full license details, refer to the [LICENSE](LICENSE) file.

## Contribution Guidelines

Contributions are welcome! Please follow these steps to contribute:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Make your changes.
4. Commit your changes (`git commit -am 'Add some feature'`).
5. Push to the branch (`git push origin feature/your-feature`).
6. Create a new Pull Request.
