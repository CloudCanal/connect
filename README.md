# Connect

A JavaScript library for building browser applications with [PocketBase](https://pocketbase.io/). Provides unified state management, event handling, and database operations through a simple API.

## Installation

Include via CDN (jsDelivr):

```html
<!-- Development -->
<script src="https://cdn.jsdelivr.net/gh/cloudcanal/connect@main/dist/connect.js"></script>

<!-- Production (minified) -->
<script src="https://cdn.jsdelivr.net/gh/cloudcanal/connect@main/dist/connect.min.js"></script>
```

The library automatically attaches to `window.cc` and auto-initializes with `window.location.origin` as the PocketBase URL.

## Quick Start

```html
<!DOCTYPE html>
<html>
    <head>
        <script src="https://cdn.jsdelivr.net/gh/cloudcanal/connect@main/dist/connect.min.js"></script>
    </head>
    <body>
        <button id="login-btn">Login</button>
        <div id="user-info"></div>

        <script>
            // Listen for auth changes
            cc.events.on('auth:change', ({ user, isAuthenticated }) => {
                document.getElementById('user-info').textContent =
                    isAuthenticated
                        ? `Welcome, ${user.email}`
                        : 'Not logged in';
            });

            // Handle login button click
            document.getElementById('login-btn').addEventListener('click', async () => {
                try {
                    await cc.db.login('user@example.com', 'password123');
                } catch (e) {
                    console.error('Login failed:', e);
                }
            });
        </script>
    </body>
</html>
```

---

## Core Concepts

Connect consists of three modules:

| Module      | Purpose                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `cc.state`  | Key-value store with optional persistence and TTL                              |
| `cc.events` | Unified event system for custom events and realtime subscriptions |
| `cc.db`     | PocketBase wrapper for auth, CRUD operations, and file handling                |

All modules work together seamlessly. State changes emit events. Database operations emit events. Subscribing to database events automatically enables realtime updates.

---

## API Reference

### cc.state

A reactive key-value store with optional persistence to `sessionStorage` or `localStorage`.

#### `state.get<T>(key: string): T | undefined`

Retrieve a value from state.

```javascript
const username = cc.state.get('username');
const user = cc.state.get('currentUser'); // Returns object if stored
```

#### `state.set(key: string, value: unknown, options?: StateOptions): void`

Store a value. Emits `state:{key}` event on change.

```javascript
// Memory only (cleared on page refresh)
cc.state.set('tempData', { foo: 'bar' });

// Persist to sessionStorage (cleared when tab closes)
cc.state.set('sessionData', 'value', { persist: 'session' });

// Persist to localStorage (persists across sessions)
cc.state.set('preferences', { theme: 'dark' }, { persist: 'local' });

// With TTL (auto-expires after 5 minutes)
cc.state.set('cache', data, { ttl: 300000 });

// Combine persistence and TTL
cc.state.set('token', 'abc123', { persist: 'local', ttl: 3600000 });
```

**StateOptions:**

| Option    | Type                     | Description                  |
| --------- | ------------------------ | ---------------------------- |
| `persist` | `'session'` \| `'local'` | Storage backend              |
| `ttl`     | `number`                 | Time to live in milliseconds |

#### `state.has(key: string): boolean`

Check if a key exists (and hasn't expired).

```javascript
if (cc.state.has('user')) {
    // User data exists
}
```

#### `state.remove(key: string): void`

Remove a key from state. Emits `state:{key}` event.

```javascript
cc.state.remove('tempData');
```

#### `state.list(): Array<{ key: string; storage: 'memory' | 'session' | 'local' }>`

List all state keys and their storage locations (useful for debugging).

```javascript
cc.state.set('user', { name: 'Pat' });
cc.state.set('theme', 'dark', { persist: 'local' });

console.log(cc.state.list());
// [
//   { key: 'user', storage: 'memory' },
//   { key: 'theme', storage: 'local' }
// ]
```

#### `state.clear(): void`

Clear all state (memory and persisted). Does not emit events.

```javascript
cc.state.clear();
```

---

### cc.events

Unified event system supporting custom events and automatic realtime subscriptions.

#### `events.on(event: string, callback: EventCallback): void`

Subscribe to an event.

```javascript
cc.events.on('auth:login', ({ user }) => {
    console.log('User logged in:', user.email);
});

cc.events.on('state:theme', ({ value, oldValue }) => {
    console.log('Theme changed from', oldValue, 'to', value);
});
```

#### `events.off(event: string, callback: EventCallback): void`

Unsubscribe from an event.

```javascript
const handler = ({ user }) => console.log(user);
cc.events.on('auth:login', handler);
cc.events.off('auth:login', handler);
```

#### `events.once(event: string, callback: EventCallback): void`

Subscribe to an event once (auto-unsubscribes after first call).

```javascript
cc.events.once('auth:login', ({ user }) => {
    showWelcomeModal(user);
});
```

#### `events.emit<T>(event: string, payload?: T): void`

Emit a custom event.

```javascript
cc.events.emit('cart:updated', { itemCount: 5 });
cc.events.emit('notification', { message: 'Item added!', type: 'success' });
```

#### `events.clear(event?: string): void`

Remove all handlers for an event, or all events if no name provided.

```javascript
cc.events.clear('auth:login'); // Clear specific event
cc.events.clear(); // Clear all events
```

#### `events.list(): Array<{ event: string }>`

List all active listeners (useful for debugging).

```javascript
console.log(cc.events.list());
// [
//   { event: 'auth:login' },
//   { event: 'db:posts:create' }
// ]
```

---

### cc.db

PocketBase wrapper with authentication, CRUD operations, realtime, and file handling.

#### Configuration

```javascript
// Change PocketBase URL (default: window.location.origin)
cc.db.url = 'https://api.example.com';

// Enable auto-cancellation for duplicate requests (default: false)
cc.db.autoCancellation = true;

// Get underlying PocketBase client for advanced usage
const pb = cc.db.client();
```

#### Authentication State

```javascript
// Check if user is authenticated
if (cc.db.isAuthenticated()) {
  console.log('User is logged in');
}

// Get current user
const user = cc.db.getUser();
console.log(user.email, user.id);

// With custom user type
const user = cc.db.getUser<{ email: string; role: string }>();
```

#### Sign Up

```javascript
const user = await cc.db.signup('user@example.com', 'password123');

// With additional data
const user = await cc.db.signup('user@example.com', 'password123', {
    name: 'John Doe',
    role: 'member',
});
```

#### Login

```javascript
// Email/password
const user = await cc.db.login('user@example.com', 'password123');

// OAuth2
const user = await cc.db.loginWithOAuth('google');
const user = await cc.db.loginWithOAuth('github');
```

#### Logout

```javascript
cc.db.logout();
```

#### Token Refresh

```javascript
const user = await cc.db.refreshAuth();
```

#### Password Reset

```javascript
// Request reset email
await cc.db.resetPassword('user@example.com');

// Confirm reset (from email link)
await cc.db.confirmResetPassword(token, 'newPassword123');
```

#### Email Verification

```javascript
// Request verification email
await cc.db.requestVerification('user@example.com');

// Confirm verification (from email link)
await cc.db.confirmVerification(token);
```

#### CRUD Operations

##### Get Single Record

```javascript
const post = await cc.db.get('posts', 'RECORD_ID');

// With expand
const post = await cc.db.get('posts', 'RECORD_ID', { expand: 'author' });
```

##### List Records (Paginated)

```javascript
const result = await cc.db.list('posts');
// { page: 1, perPage: 20, totalItems: 100, totalPages: 5, items: [...] }

// With options
const result = await cc.db.list('posts', {
    page: 2,
    perPage: 10,
    filter: 'status = "published"',
    sort: '-created',
    expand: 'author,comments',
});
```

##### Get All Records

```javascript
const allPosts = await cc.db.getAll('posts');

// With filter
const myPosts = await cc.db.getAll('posts', {
    filter: `author = "${userId}"`,
});
```

##### Get First Matching Record

```javascript
const post = await cc.db.getFirst('posts', 'slug = "hello-world"');
// Returns null if not found (doesn't throw)
```

##### Create Record

```javascript
const post = await cc.db.create('posts', {
    title: 'Hello World',
    content: 'My first post',
    status: 'draft',
});
```

##### Update Record

```javascript
const updated = await cc.db.update('posts', 'RECORD_ID', {
    status: 'published',
});
```

##### Delete Record

```javascript
await cc.db.delete('posts', 'RECORD_ID');
```

#### File Uploads

Use `FormData` with `create` or `update`:

```javascript
// Create with file
const form = new FormData();
form.append('title', 'My Image');
form.append('image', fileInput.files[0]);

const record = await cc.db.create('gallery', form);

// Update with file
const form = new FormData();
form.append('avatar', fileInput.files[0]);

await cc.db.update('users', userId, form);
```

#### Get File URL

```javascript
const url = cc.db.getFileUrl(record, record.image);

// With thumbnail
const thumbUrl = cc.db.getFileUrl(record, record.image, { thumb: '100x100' });
```

---

## Events Reference

### Authentication Events

| Event                 | Payload                                              | Triggered When                                    |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `auth:change`         | `{ user: DbUser \| null, isAuthenticated: boolean }` | Auth state changes (login, logout, token refresh) |
| `auth:signup`         | `{ user: DbUser }`                                   | User signs up                                     |
| `auth:login`          | `{ user: DbUser }`                                   | User logs in                                      |
| `auth:logout`         | `{ user: DbUser \| null }`                           | User logs out                                     |
| `auth:refresh`        | `{ user: DbUser }`                                   | Auth token refreshed                              |
| `auth:reset-request`  | `{ email: string }`                                  | Password reset requested                          |
| `auth:reset-confirm`  | `{}`                                                 | Password reset confirmed                          |
| `auth:verify-request` | `{ email: string }`                                  | Email verification requested                      |
| `auth:verify-confirm` | `{}`                                                 | Email verification confirmed                      |

### Database Events (Realtime)

Subscribe to database events to automatically enable realtime updates.

**Collection-wide format:** `db:{collection}:{action}`
**Record-specific format:** `db:{collection}:{action}:{id}` (update/delete only)

| Event Pattern                 | Payload                   | Description             |
| ----------------------------- | ------------------------- | ----------------------- |
| `db:{collection}:create`      | `{ record: RecordModel }` | Any record created      |
| `db:{collection}:update`      | `{ record: RecordModel }` | Any record updated      |
| `db:{collection}:delete`      | `{ id: string }`          | Any record deleted      |
| `db:{collection}:update:{id}` | `{ record: RecordModel }` | Specific record updated |
| `db:{collection}:delete:{id}` | `{ id: string }`          | Specific record deleted |

**Examples:**

```javascript
// Listen to all posts updates
cc.events.on('db:posts:create', ({ record }) => {
    console.log('New post:', record.title);
});

cc.events.on('db:posts:update', ({ record }) => {
    console.log('Post updated:', record.id);
});

// Listen to a specific post only
cc.events.on('db:posts:update:abc123', ({ record }) => {
    console.log('Post abc123 was updated:', record.title);
});

cc.events.on('db:posts:delete:abc123', ({ id }) => {
    console.log('Post abc123 was deleted');
});
```

**Automatic Realtime Management:**

-   Subscribing to any `db:*` event automatically enables PocketBase realtime
-   Collection-wide events use `subscribe('*', ...)` for all records
-   Record-specific events use `subscribe(recordId, ...)` for targeted updates
-   Unsubscribing from the last listener automatically disables the subscription
-   No manual subscription management required

### State Events

| Event Pattern | Payload                                 | Description                  |
| ------------- | --------------------------------------- | ---------------------------- |
| `state:{key}` | `{ value: unknown, oldValue: unknown }` | State key changed or deleted |

**Examples:**

```javascript
cc.events.on('state:theme', ({ value, oldValue }) => {
    document.body.className = value;
});

cc.events.on('state:cart', ({ value }) => {
    updateCartBadge(value?.items?.length || 0);
});
```

---

## Complete Examples

### User Authentication Flow

```html
<form id="auth-form">
    <input type="email" name="email" placeholder="Email" required />
    <input type="password" name="password" placeholder="Password" required />
    <button type="submit">Login</button>
    <button type="button" id="signup-btn">Sign Up</button>
    <button type="button" id="google-btn">Login with Google</button>
</form>
<div id="user-area" style="display: none;">
    <span id="user-email"></span>
    <button id="logout-btn">Logout</button>
</div>

<script>
    // Update UI on auth changes
    cc.events.on('auth:change', ({ user, isAuthenticated }) => {
        document.getElementById('auth-form').style.display = isAuthenticated
            ? 'none'
            : 'block';
        document.getElementById('user-area').style.display = isAuthenticated
            ? 'block'
            : 'none';
        if (user) {
            document.getElementById('user-email').textContent = user.email;
        }
    });

    // Login form
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        try {
            await cc.db.login(form.get('email'), form.get('password'));
        } catch (err) {
            alert('Login failed: ' + err.message);
        }
    });

    // Sign up
    document.getElementById('signup-btn').addEventListener('click', async () => {
        const email = document.querySelector('[name="email"]').value;
        const password = document.querySelector('[name="password"]').value;
        try {
            await cc.db.signup(email, password);
            await cc.db.login(email, password);
        } catch (err) {
            alert('Signup failed: ' + err.message);
        }
    });

    // Google OAuth
    document.getElementById('google-btn').addEventListener('click', async () => {
        try {
            await cc.db.loginWithOAuth('google');
        } catch (err) {
            alert('OAuth failed: ' + err.message);
        }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => {
        cc.db.logout();
    });
</script>
```

### Realtime Chat Application

```html
<div id="messages"></div>
<form id="message-form">
    <input
        type="text"
        name="content"
        placeholder="Type a message..."
        required
    />
    <button type="submit">Send</button>
</form>

<script>
    const messagesDiv = document.getElementById('messages');
    const currentUser = cc.db.getUser();

    // Load existing messages
    async function loadMessages() {
        const messages = await cc.db.getAll('messages', {
            sort: 'created',
            expand: 'author',
        });
        messagesDiv.innerHTML = '';
        messages.forEach(addMessageToUI);
    }

    function addMessageToUI(msg) {
        const div = document.createElement('div');
        div.className = 'message';
        div.dataset.id = msg.id;
        div.innerHTML = `
      <strong>${msg.expand?.author?.name || 'Unknown'}:</strong>
      ${msg.content}
    `;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // Send message
    document.getElementById('message-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        await cc.db.create('messages', {
            content: form.get('content'),
            author: currentUser.id,
        });
        e.target.reset();
    });

    // Realtime: new messages
    cc.events.on('db:messages:create', ({ record }) => {
        addMessageToUI(record);
    });

    // Realtime: deleted messages
    cc.events.on('db:messages:delete', ({ id }) => {
        document.querySelector(`.message[data-id="${id}"]`)?.remove();
    });

    // Initialize
    loadMessages();
</script>
```

### Todo List with Persistence

```html
<input type="text" id="new-todo" placeholder="Add a todo..." />
<ul id="todo-list"></ul>

<script>
    // Load todos from state or fetch from server
    async function init() {
        let todos = cc.state.get('todos');
        if (!todos) {
            todos = await cc.db.getAll('todos', {
                filter: `user = "${cc.db.getUser()?.id}"`,
            });
            cc.state.set('todos', todos);
        }
        renderTodos(todos);
    }

    function renderTodos(todos) {
        const list = document.getElementById('todo-list');
        list.innerHTML = todos
            .map(
                (t) => `
      <li data-id="${t.id}">
        <input type="checkbox" ${t.completed ? 'checked' : ''}>
        <span>${t.title}</span>
        <button class="delete-btn">Delete</button>
      </li>
    `
            )
            .join('');
    }

    // React to state changes
    cc.events.on('state:todos', ({ value }) => {
        renderTodos(value || []);
    });

    // Add todo
    document.getElementById('new-todo').addEventListener('keypress', async (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;

        const todo = await cc.db.create('todos', {
            title: e.target.value.trim(),
            completed: false,
            user: cc.db.getUser().id,
        });

        const todos = cc.state.get('todos') || [];
        cc.state.set('todos', [...todos, todo]);
        e.target.value = '';
    });

    // Toggle completion and delete (event delegation)
    document.getElementById('todo-list').addEventListener('click', async (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        const id = li.dataset.id;

        if (e.target.matches('input[type="checkbox"]')) {
            const completed = e.target.checked;
            await cc.db.update('todos', id, { completed });
            const todos = cc.state
                .get('todos')
                .map((t) => (t.id === id ? { ...t, completed } : t));
            cc.state.set('todos', todos);
        }

        if (e.target.matches('.delete-btn')) {
            await cc.db.delete('todos', id);
            const todos = cc.state.get('todos').filter((t) => t.id !== id);
            cc.state.set('todos', todos);
        }
    });

    // Sync with realtime updates from other devices
    cc.events.on('db:todos:create', ({ record }) => {
        const todos = cc.state.get('todos') || [];
        if (!todos.find((t) => t.id === record.id)) {
            cc.state.set('todos', [...todos, record]);
        }
    });

    cc.events.on('db:todos:update', ({ record }) => {
        const todos = cc.state
            .get('todos')
            .map((t) => (t.id === record.id ? record : t));
        cc.state.set('todos', todos);
    });

    cc.events.on('db:todos:delete', ({ id }) => {
        const todos = cc.state.get('todos').filter((t) => t.id !== id);
        cc.state.set('todos', todos);
    });

    init();
</script>
```

### Image Gallery with Uploads

```html
<form id="upload-form">
    <input type="file" name="image" accept="image/*" required />
    <input type="text" name="caption" placeholder="Caption" />
    <button type="submit">Upload</button>
</form>
<div id="gallery"></div>

<script>
    async function loadGallery() {
        const images = await cc.db.getAll('gallery', { sort: '-created' });
        renderGallery(images);
    }

    function renderGallery(images) {
        const gallery = document.getElementById('gallery');
        gallery.innerHTML = images
            .map(
                (img) => `
      <div class="image-card" data-id="${img.id}">
        <img src="${cc.db.getFileUrl(img, img.image, {
            thumb: '300x300',
        })}" alt="${img.caption}">
        <p>${img.caption || ''}</p>
        <button class="delete-btn">Delete</button>
      </div>
    `
            )
            .join('');
    }

    // Upload image
    document.getElementById('upload-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        form.append('user', cc.db.getUser().id);

        await cc.db.create('gallery', form);
        e.target.reset();
    });

    // Delete image (event delegation)
    document.getElementById('gallery').addEventListener('click', async (e) => {
        if (e.target.matches('.delete-btn')) {
            const id = e.target.closest('.image-card').dataset.id;
            await cc.db.delete('gallery', id);
        }
    });

    // Realtime updates
    cc.events.on('db:gallery:create', loadGallery);
    cc.events.on('db:gallery:delete', loadGallery);

    loadGallery();
</script>
```

---

## Configuration

### PocketBase URL

By default, Connect uses `window.location.origin`. Override for different backend:

```javascript
cc.db.url = 'https://api.myapp.com';
```

### Auto-Cancellation

PocketBase auto-cancels duplicate pending requests by default. Connect disables this:

```javascript
// Default: false (requests not auto-cancelled)
cc.db.autoCancellation = false;

// Enable if you want duplicate requests cancelled
cc.db.autoCancellation = true;
```

### Advanced PocketBase Access

For features not wrapped by Connect, access the underlying client:

```javascript
const pb = cc.db.client();

// Use any PocketBase SDK feature
pb.health.check();
pb.backups.getFullList();
```

---

## TypeScript Support

Connect exports TypeScript types:

```typescript
import {
    cc,
    state,
    events,
    db,
    StateOptions,
    EventCallback,
    DbUser,
    ListOptions,
    ListResult,
} from 'cloud-canal-connect';

// Custom user type
interface MyUser extends DbUser {
    role: 'admin' | 'user';
    plan: string;
}

const user = cc.db.getUser<MyUser>();
```

---

## License

MIT
