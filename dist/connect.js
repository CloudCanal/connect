(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.cc = {}));
})(this, (function (exports) { 'use strict';

    // Central listener registry
    const listeners = [];
    const customHandlers = new Map();
    // Track realtime subscriptions (collection -> listener count)
    const realtimeCollections = new Map();
    // Track record-specific subscriptions (collection:id -> listener count)
    const realtimeRecords = new Map();
    // Reference to db module (set via setDbModule to avoid circular imports)
    let dbModule = null;
    /**
     * Set the db module reference (called from db.ts to avoid circular imports)
     */
    function setDbModule(db) {
        dbModule = db;
    }
    /**
     * Parse a db event name to extract collection, action, and optional record ID
     * Returns null if not a db event
     * Format: db:{collection}:{action} or db:{collection}:{action}:{id}
     */
    function parseDbEvent(eventName) {
        const match = eventName.match(/^db:([^:]+):(create|update|delete)(?::(.+))?$/);
        if (match) {
            return {
                collection: match[1],
                action: match[2],
                id: match[3] // undefined if not present
            };
        }
        return null;
    }
    /**
     * Handle realtime subscription when db:* listener added
     */
    async function handleRealtimeAdd(collection, id) {
        // Record-specific subscription (only for update/delete, not create)
        if (id) {
            const key = `${collection}:${id}`;
            const count = (realtimeRecords.get(key) || 0) + 1;
            realtimeRecords.set(key, count);
            // First listener for this record - enable realtime
            if (count === 1 && dbModule) {
                await dbModule.enableRealtimeRecord(collection, id);
            }
            return;
        }
        // Collection-wide subscription
        const count = (realtimeCollections.get(collection) || 0) + 1;
        realtimeCollections.set(collection, count);
        // First listener for this collection - enable realtime
        if (count === 1 && dbModule) {
            await dbModule.enableRealtime(collection);
        }
    }
    /**
     * Handle realtime unsubscription when db:* listener removed
     */
    async function handleRealtimeRemove(collection, id) {
        // Record-specific subscription
        if (id) {
            const key = `${collection}:${id}`;
            const count = (realtimeRecords.get(key) || 1) - 1;
            if (count <= 0) {
                realtimeRecords.delete(key);
                // Last listener removed - disable realtime for this record
                if (dbModule) {
                    await dbModule.disableRealtimeRecord(collection, id);
                }
            }
            else {
                realtimeRecords.set(key, count);
            }
            return;
        }
        // Collection-wide subscription
        const count = (realtimeCollections.get(collection) || 1) - 1;
        if (count <= 0) {
            realtimeCollections.delete(collection);
            // Last listener removed - disable realtime
            if (dbModule) {
                await dbModule.disableRealtime(collection);
            }
        }
        else {
            realtimeCollections.set(collection, count);
        }
    }
    const events = {
        /**
         * Subscribe to an event
         */
        on(event, callback) {
            const entry = { event, callback };
            listeners.push(entry);
            if (!customHandlers.has(event)) {
                customHandlers.set(event, new Set());
            }
            customHandlers.get(event).add(callback);
            // Check for db:* events to enable realtime
            const dbEvent = parseDbEvent(event);
            if (dbEvent) {
                // Only allow record ID for update/delete (can't subscribe to non-existent record for create)
                const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
                handleRealtimeAdd(dbEvent.collection, id);
            }
        },
        /**
         * Unsubscribe from an event
         */
        off(event, callback) {
            const index = listeners.findIndex(l => l.event === event &&
                (l.callback === callback || l.originalCallback === callback));
            if (index !== -1) {
                const entry = listeners[index];
                listeners.splice(index, 1);
                customHandlers.get(event)?.delete(entry.callback);
                if (entry.originalCallback) {
                    customHandlers.get(event)?.delete(entry.originalCallback);
                }
                // Check for db:* events to disable realtime
                const dbEvent = parseDbEvent(event);
                if (dbEvent) {
                    const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
                    handleRealtimeRemove(dbEvent.collection, id);
                }
            }
        },
        /**
         * Subscribe to an event once (auto-unsubscribes after first call)
         */
        once(event, callback) {
            const wrapper = (payload) => {
                this.off(event, wrapper);
                callback(payload);
            };
            const entry = {
                event,
                callback: wrapper,
                originalCallback: callback
            };
            listeners.push(entry);
            if (!customHandlers.has(event)) {
                customHandlers.set(event, new Set());
            }
            customHandlers.get(event).add(wrapper);
            const dbEvent = parseDbEvent(event);
            if (dbEvent) {
                const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
                handleRealtimeAdd(dbEvent.collection, id);
            }
        },
        /**
         * Emit a custom event
         */
        emit(event, payload) {
            const handlers = customHandlers.get(event);
            if (!handlers)
                return;
            handlers.forEach(handler => {
                try {
                    handler(payload);
                }
                catch (e) {
                    console.error(`Error in event handler for "${event}":`, e);
                }
            });
        },
        /**
         * Clear all handlers for an event, or all events if no name provided
         */
        clear(event) {
            if (event) {
                // Clear specific event
                const toRemove = listeners.filter(l => l.event === event);
                toRemove.forEach(entry => {
                    const index = listeners.indexOf(entry);
                    if (index !== -1)
                        listeners.splice(index, 1);
                });
                customHandlers.delete(event);
                const dbEvent = parseDbEvent(event);
                if (dbEvent) {
                    const id = dbEvent.action !== 'create' ? dbEvent.id : undefined;
                    if (id) {
                        const key = `${dbEvent.collection}:${id}`;
                        if (realtimeRecords.has(key)) {
                            realtimeRecords.delete(key);
                            dbModule?.disableRealtimeRecord(dbEvent.collection, id);
                        }
                    }
                    else if (realtimeCollections.has(dbEvent.collection)) {
                        realtimeCollections.delete(dbEvent.collection);
                        dbModule?.disableRealtime(dbEvent.collection);
                    }
                }
            }
            else {
                // Clear all
                listeners.length = 0;
                customHandlers.clear();
                // Disable all collection-wide realtime
                realtimeCollections.forEach((_, collection) => {
                    dbModule?.disableRealtime(collection);
                });
                realtimeCollections.clear();
                // Disable all record-specific realtime
                realtimeRecords.forEach((_, key) => {
                    const [collection, id] = key.split(':');
                    dbModule?.disableRealtimeRecord(collection, id);
                });
                realtimeRecords.clear();
            }
        },
        /**
         * List all active listeners (for debugging)
         */
        list() {
            return listeners.map(l => ({
                event: l.event
            }));
        }
    };

    // Constants
    const STORAGE_PREFIX = 'cc:';
    // In-memory store for non-persisted values
    const memoryStore = new Map();
    /**
     * Get the appropriate storage backend
     */
    function getStorage(persist) {
        if (typeof window === 'undefined')
            return null;
        switch (persist) {
            case 'session':
                return sessionStorage;
            case 'local':
                return localStorage;
            default:
                return null;
        }
    }
    /**
     * Check if a stored value has expired
     */
    function isExpired(stored) {
        return stored.expiry !== undefined && Date.now() > stored.expiry;
    }
    /**
     * Get a value from storage
     */
    function getFromStorage(key, storage) {
        try {
            const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
            if (!raw)
                return null;
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    /**
     * Save a value to storage
     */
    function saveToStorage(key, stored, storage) {
        try {
            storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(stored));
        }
        catch (e) {
            console.error(`Failed to save to storage: ${key}`, e);
        }
    }
    /**
     * Remove a value from storage
     */
    function removeFromStorage(key, storage) {
        storage.removeItem(`${STORAGE_PREFIX}${key}`);
    }
    const state = {
        /**
         * Get a value from state
         * Checks memory first, then session storage, then local storage
         */
        get(key) {
            // Check memory first
            const mem = memoryStore.get(key);
            if (mem) {
                if (isExpired(mem)) {
                    this.remove(key);
                    return undefined;
                }
                return mem.value;
            }
            // Check persistent stores
            for (const persist of ['session', 'local']) {
                const storage = getStorage(persist);
                if (!storage)
                    continue;
                const stored = getFromStorage(key, storage);
                if (stored) {
                    if (isExpired(stored)) {
                        removeFromStorage(key, storage);
                        continue;
                    }
                    return stored.value;
                }
            }
            return undefined;
        },
        /**
         * Set a value in state
         * Emits 'state:{key}' event with { value, oldValue }
         */
        set(key, value, options = {}) {
            const { persist, ttl } = options;
            const oldValue = this.get(key);
            const stored = {
                value,
                expiry: ttl ? Date.now() + ttl : undefined
            };
            const storage = getStorage(persist);
            if (storage) {
                saveToStorage(key, stored, storage);
                // Also remove from memory if it was there
                memoryStore.delete(key);
            }
            else {
                memoryStore.set(key, stored);
            }
            // Emit state change event
            events.emit(`state:${key}`, { value, oldValue });
        },
        /**
         * Check if a key exists in state
         */
        has(key) {
            return this.get(key) !== undefined;
        },
        /**
         * Remove a key from state
         * Emits 'state:{key}' event with { value: undefined, oldValue }
         */
        remove(key) {
            const oldValue = this.get(key);
            if (oldValue === undefined)
                return;
            // Remove from memory
            memoryStore.delete(key);
            // Remove from all persistent stores
            for (const persist of ['session', 'local']) {
                const storage = getStorage(persist);
                if (storage) {
                    removeFromStorage(key, storage);
                }
            }
            // Emit state change event
            events.emit(`state:${key}`, { value: undefined, oldValue });
        },
        /**
         * List all state keys and their storage locations
         * Useful for debugging
         */
        list() {
            const result = [];
            // List memory keys
            for (const [key, stored] of memoryStore) {
                if (!isExpired(stored)) {
                    result.push({ key, storage: 'memory' });
                }
            }
            // List persistent storage keys
            for (const persist of ['session', 'local']) {
                const storage = getStorage(persist);
                if (!storage)
                    continue;
                for (let i = 0; i < storage.length; i++) {
                    const rawKey = storage.key(i);
                    if (rawKey?.startsWith(STORAGE_PREFIX)) {
                        const key = rawKey.slice(STORAGE_PREFIX.length);
                        const stored = getFromStorage(key, storage);
                        if (stored && !isExpired(stored)) {
                            result.push({ key, storage: persist });
                        }
                    }
                }
            }
            return result;
        },
        /**
         * Clear all state
         * Does NOT emit events for each key
         */
        clear() {
            // Clear memory
            memoryStore.clear();
            // Clear persistent storage with our prefix
            for (const persist of ['session', 'local']) {
                const storage = getStorage(persist);
                if (!storage)
                    continue;
                const keysToRemove = [];
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    if (key?.startsWith(STORAGE_PREFIX)) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(k => storage.removeItem(k));
            }
        }
    };

    class ClientResponseError extends Error{constructor(e){super("ClientResponseError"),this.url="",this.status=0,this.response={},this.isAbort=false,this.originalError=null,Object.setPrototypeOf(this,ClientResponseError.prototype),null!==e&&"object"==typeof e&&(this.url="string"==typeof e.url?e.url:"",this.status="number"==typeof e.status?e.status:0,this.isAbort=!!e.isAbort,this.originalError=e.originalError,null!==e.response&&"object"==typeof e.response?this.response=e.response:null!==e.data&&"object"==typeof e.data?this.response=e.data:this.response={}),this.originalError||e instanceof ClientResponseError||(this.originalError=e),"undefined"!=typeof DOMException&&e instanceof DOMException&&("AbortError"==e.name||20==e.code)&&(this.isAbort=true),this.name="ClientResponseError "+this.status,this.message=this.response?.message,this.message||(this.isAbort?this.message="The request was autocancelled. You can find more info in https://github.com/pocketbase/js-sdk#auto-cancellation.":this.originalError?.cause?.message?.includes("ECONNREFUSED ::1")?this.message="Failed to connect to the PocketBase server. Try changing the SDK URL from localhost to 127.0.0.1 (https://github.com/pocketbase/js-sdk/issues/21).":this.message="Something went wrong."),this.cause=this.originalError;}get data(){return this.response}toJSON(){return {...this}}}const e=/^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;function cookieParse(e,t){const s={};if("string"!=typeof e)return s;const i=Object.assign({},{}).decode||defaultDecode;let n=0;for(;n<e.length;){const t=e.indexOf("=",n);if(-1===t)break;let r=e.indexOf(";",n);if(-1===r)r=e.length;else if(r<t){n=e.lastIndexOf(";",t-1)+1;continue}const o=e.slice(n,t).trim();if(void 0===s[o]){let n=e.slice(t+1,r).trim();34===n.charCodeAt(0)&&(n=n.slice(1,-1));try{s[o]=i(n);}catch(e){s[o]=n;}}n=r+1;}return s}function cookieSerialize(t,s,i){const n=Object.assign({},i||{}),r=n.encode||defaultEncode;if(!e.test(t))throw new TypeError("argument name is invalid");const o=r(s);if(o&&!e.test(o))throw new TypeError("argument val is invalid");let a=t+"="+o;if(null!=n.maxAge){const e=n.maxAge-0;if(isNaN(e)||!isFinite(e))throw new TypeError("option maxAge is invalid");a+="; Max-Age="+Math.floor(e);}if(n.domain){if(!e.test(n.domain))throw new TypeError("option domain is invalid");a+="; Domain="+n.domain;}if(n.path){if(!e.test(n.path))throw new TypeError("option path is invalid");a+="; Path="+n.path;}if(n.expires){if(!function isDate(e){return "[object Date]"===Object.prototype.toString.call(e)||e instanceof Date}(n.expires)||isNaN(n.expires.valueOf()))throw new TypeError("option expires is invalid");a+="; Expires="+n.expires.toUTCString();}if(n.httpOnly&&(a+="; HttpOnly"),n.secure&&(a+="; Secure"),n.priority){switch("string"==typeof n.priority?n.priority.toLowerCase():n.priority){case "low":a+="; Priority=Low";break;case "medium":a+="; Priority=Medium";break;case "high":a+="; Priority=High";break;default:throw new TypeError("option priority is invalid")}}if(n.sameSite){switch("string"==typeof n.sameSite?n.sameSite.toLowerCase():n.sameSite){case  true:a+="; SameSite=Strict";break;case "lax":a+="; SameSite=Lax";break;case "strict":a+="; SameSite=Strict";break;case "none":a+="; SameSite=None";break;default:throw new TypeError("option sameSite is invalid")}}return a}function defaultDecode(e){return  -1!==e.indexOf("%")?decodeURIComponent(e):e}function defaultEncode(e){return encodeURIComponent(e)}const t="undefined"!=typeof navigator&&"ReactNative"===navigator.product||"undefined"!=typeof global&&global.HermesInternal;let s;function getTokenPayload(e){if(e)try{const t=decodeURIComponent(s(e.split(".")[1]).split("").map((function(e){return "%"+("00"+e.charCodeAt(0).toString(16)).slice(-2)})).join(""));return JSON.parse(t)||{}}catch(e){}return {}}function isTokenExpired(e,t=0){let s=getTokenPayload(e);return !(Object.keys(s).length>0&&(!s.exp||s.exp-t>Date.now()/1e3))}s="function"!=typeof atob||t?e=>{let t=String(e).replace(/=+$/,"");if(t.length%4==1)throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");for(var s,i,n=0,r=0,o="";i=t.charAt(r++);~i&&(s=n%4?64*s+i:i,n++%4)?o+=String.fromCharCode(255&s>>(-2*n&6)):0)i="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".indexOf(i);return o}:atob;const i="pb_auth";class BaseAuthStore{constructor(){this.baseToken="",this.baseModel=null,this._onChangeCallbacks=[];}get token(){return this.baseToken}get record(){return this.baseModel}get model(){return this.baseModel}get isValid(){return !isTokenExpired(this.token)}get isSuperuser(){let e=getTokenPayload(this.token);return "auth"==e.type&&("_superusers"==this.record?.collectionName||!this.record?.collectionName&&"pbc_3142635823"==e.collectionId)}get isAdmin(){return console.warn("Please replace pb.authStore.isAdmin with pb.authStore.isSuperuser OR simply check the value of pb.authStore.record?.collectionName"),this.isSuperuser}get isAuthRecord(){return console.warn("Please replace pb.authStore.isAuthRecord with !pb.authStore.isSuperuser OR simply check the value of pb.authStore.record?.collectionName"),"auth"==getTokenPayload(this.token).type&&!this.isSuperuser}save(e,t){this.baseToken=e||"",this.baseModel=t||null,this.triggerChange();}clear(){this.baseToken="",this.baseModel=null,this.triggerChange();}loadFromCookie(e,t=i){const s=cookieParse(e||"")[t]||"";let n={};try{n=JSON.parse(s),(null===typeof n||"object"!=typeof n||Array.isArray(n))&&(n={});}catch(e){}this.save(n.token||"",n.record||n.model||null);}exportToCookie(e,t=i){const s={secure:true,sameSite:true,httpOnly:true,path:"/"},n=getTokenPayload(this.token);s.expires=n?.exp?new Date(1e3*n.exp):new Date("1970-01-01"),e=Object.assign({},s,e);const r={token:this.token,record:this.record?JSON.parse(JSON.stringify(this.record)):null};let o=cookieSerialize(t,JSON.stringify(r),e);const a="undefined"!=typeof Blob?new Blob([o]).size:o.length;if(r.record&&a>4096){r.record={id:r.record?.id,email:r.record?.email};const s=["collectionId","collectionName","verified"];for(const e in this.record)s.includes(e)&&(r.record[e]=this.record[e]);o=cookieSerialize(t,JSON.stringify(r),e);}return o}onChange(e,t=false){return this._onChangeCallbacks.push(e),t&&e(this.token,this.record),()=>{for(let t=this._onChangeCallbacks.length-1;t>=0;t--)if(this._onChangeCallbacks[t]==e)return delete this._onChangeCallbacks[t],void this._onChangeCallbacks.splice(t,1)}}triggerChange(){for(const e of this._onChangeCallbacks)e&&e(this.token,this.record);}}class LocalAuthStore extends BaseAuthStore{constructor(e="pocketbase_auth"){super(),this.storageFallback={},this.storageKey=e,this._bindStorageEvent();}get token(){return (this._storageGet(this.storageKey)||{}).token||""}get record(){const e=this._storageGet(this.storageKey)||{};return e.record||e.model||null}get model(){return this.record}save(e,t){this._storageSet(this.storageKey,{token:e,record:t}),super.save(e,t);}clear(){this._storageRemove(this.storageKey),super.clear();}_storageGet(e){if("undefined"!=typeof window&&window?.localStorage){const t=window.localStorage.getItem(e)||"";try{return JSON.parse(t)}catch(e){return t}}return this.storageFallback[e]}_storageSet(e,t){if("undefined"!=typeof window&&window?.localStorage){let s=t;"string"!=typeof t&&(s=JSON.stringify(t)),window.localStorage.setItem(e,s);}else this.storageFallback[e]=t;}_storageRemove(e){"undefined"!=typeof window&&window?.localStorage&&window.localStorage?.removeItem(e),delete this.storageFallback[e];}_bindStorageEvent(){"undefined"!=typeof window&&window?.localStorage&&window.addEventListener&&window.addEventListener("storage",(e=>{if(e.key!=this.storageKey)return;const t=this._storageGet(this.storageKey)||{};super.save(t.token||"",t.record||t.model||null);}));}}class BaseService{constructor(e){this.client=e;}}class SettingsService extends BaseService{async getAll(e){return e=Object.assign({method:"GET"},e),this.client.send("/api/settings",e)}async update(e,t){return t=Object.assign({method:"PATCH",body:e},t),this.client.send("/api/settings",t)}async testS3(e="storage",t){return t=Object.assign({method:"POST",body:{filesystem:e}},t),this.client.send("/api/settings/test/s3",t).then((()=>true))}async testEmail(e,t,s,i){return i=Object.assign({method:"POST",body:{email:t,template:s,collection:e}},i),this.client.send("/api/settings/test/email",i).then((()=>true))}async generateAppleClientSecret(e,t,s,i,n,r){return r=Object.assign({method:"POST",body:{clientId:e,teamId:t,keyId:s,privateKey:i,duration:n}},r),this.client.send("/api/settings/apple/generate-client-secret",r)}}const n=["requestKey","$cancelKey","$autoCancel","fetch","headers","body","query","params","cache","credentials","headers","integrity","keepalive","method","mode","redirect","referrer","referrerPolicy","signal","window"];function normalizeUnknownQueryParams(e){if(e){e.query=e.query||{};for(let t in e)n.includes(t)||(e.query[t]=e[t],delete e[t]);}}function serializeQueryParams(e){const t=[];for(const s in e){const i=encodeURIComponent(s),n=Array.isArray(e[s])?e[s]:[e[s]];for(let e of n)e=prepareQueryParamValue(e),null!==e&&t.push(i+"="+e);}return t.join("&")}function prepareQueryParamValue(e){return null==e?null:e instanceof Date?encodeURIComponent(e.toISOString().replace("T"," ")):"object"==typeof e?encodeURIComponent(JSON.stringify(e)):encodeURIComponent(e)}class RealtimeService extends BaseService{constructor(){super(...arguments),this.clientId="",this.eventSource=null,this.subscriptions={},this.lastSentSubscriptions=[],this.maxConnectTimeout=15e3,this.reconnectAttempts=0,this.maxReconnectAttempts=1/0,this.predefinedReconnectIntervals=[200,300,500,1e3,1200,1500,2e3],this.pendingConnects=[];}get isConnected(){return !!this.eventSource&&!!this.clientId&&!this.pendingConnects.length}async subscribe(e,t,s){if(!e)throw new Error("topic must be set.");let i=e;if(s){normalizeUnknownQueryParams(s=Object.assign({},s));const e="options="+encodeURIComponent(JSON.stringify({query:s.query,headers:s.headers}));i+=(i.includes("?")?"&":"?")+e;}const listener=function(e){const s=e;let i;try{i=JSON.parse(s?.data);}catch{}t(i||{});};return this.subscriptions[i]||(this.subscriptions[i]=[]),this.subscriptions[i].push(listener),this.isConnected?1===this.subscriptions[i].length?await this.submitSubscriptions():this.eventSource?.addEventListener(i,listener):await this.connect(),async()=>this.unsubscribeByTopicAndListener(e,listener)}async unsubscribe(e){let t=false;if(e){const s=this.getSubscriptionsByTopic(e);for(let e in s)if(this.hasSubscriptionListeners(e)){for(let t of this.subscriptions[e])this.eventSource?.removeEventListener(e,t);delete this.subscriptions[e],t||(t=true);}}else this.subscriptions={};this.hasSubscriptionListeners()?t&&await this.submitSubscriptions():this.disconnect();}async unsubscribeByPrefix(e){let t=false;for(let s in this.subscriptions)if((s+"?").startsWith(e)){t=true;for(let e of this.subscriptions[s])this.eventSource?.removeEventListener(s,e);delete this.subscriptions[s];}t&&(this.hasSubscriptionListeners()?await this.submitSubscriptions():this.disconnect());}async unsubscribeByTopicAndListener(e,t){let s=false;const i=this.getSubscriptionsByTopic(e);for(let e in i){if(!Array.isArray(this.subscriptions[e])||!this.subscriptions[e].length)continue;let i=false;for(let s=this.subscriptions[e].length-1;s>=0;s--)this.subscriptions[e][s]===t&&(i=true,delete this.subscriptions[e][s],this.subscriptions[e].splice(s,1),this.eventSource?.removeEventListener(e,t));i&&(this.subscriptions[e].length||delete this.subscriptions[e],s||this.hasSubscriptionListeners(e)||(s=true));}this.hasSubscriptionListeners()?s&&await this.submitSubscriptions():this.disconnect();}hasSubscriptionListeners(e){if(this.subscriptions=this.subscriptions||{},e)return !!this.subscriptions[e]?.length;for(let e in this.subscriptions)if(this.subscriptions[e]?.length)return  true;return  false}async submitSubscriptions(){if(this.clientId)return this.addAllSubscriptionListeners(),this.lastSentSubscriptions=this.getNonEmptySubscriptionKeys(),this.client.send("/api/realtime",{method:"POST",body:{clientId:this.clientId,subscriptions:this.lastSentSubscriptions},requestKey:this.getSubscriptionsCancelKey()}).catch((e=>{if(!e?.isAbort)throw e}))}getSubscriptionsCancelKey(){return "realtime_"+this.clientId}getSubscriptionsByTopic(e){const t={};e=e.includes("?")?e:e+"?";for(let s in this.subscriptions)(s+"?").startsWith(e)&&(t[s]=this.subscriptions[s]);return t}getNonEmptySubscriptionKeys(){const e=[];for(let t in this.subscriptions)this.subscriptions[t].length&&e.push(t);return e}addAllSubscriptionListeners(){if(this.eventSource){this.removeAllSubscriptionListeners();for(let e in this.subscriptions)for(let t of this.subscriptions[e])this.eventSource.addEventListener(e,t);}}removeAllSubscriptionListeners(){if(this.eventSource)for(let e in this.subscriptions)for(let t of this.subscriptions[e])this.eventSource.removeEventListener(e,t);}async connect(){if(!(this.reconnectAttempts>0))return new Promise(((e,t)=>{this.pendingConnects.push({resolve:e,reject:t}),this.pendingConnects.length>1||this.initConnect();}))}initConnect(){this.disconnect(true),clearTimeout(this.connectTimeoutId),this.connectTimeoutId=setTimeout((()=>{this.connectErrorHandler(new Error("EventSource connect took too long."));}),this.maxConnectTimeout),this.eventSource=new EventSource(this.client.buildURL("/api/realtime")),this.eventSource.onerror=e=>{this.connectErrorHandler(new Error("Failed to establish realtime connection."));},this.eventSource.addEventListener("PB_CONNECT",(e=>{const t=e;this.clientId=t?.lastEventId,this.submitSubscriptions().then((async()=>{let e=3;for(;this.hasUnsentSubscriptions()&&e>0;)e--,await this.submitSubscriptions();})).then((()=>{for(let e of this.pendingConnects)e.resolve();this.pendingConnects=[],this.reconnectAttempts=0,clearTimeout(this.reconnectTimeoutId),clearTimeout(this.connectTimeoutId);const t=this.getSubscriptionsByTopic("PB_CONNECT");for(let s in t)for(let i of t[s])i(e);})).catch((e=>{this.clientId="",this.connectErrorHandler(e);}));}));}hasUnsentSubscriptions(){const e=this.getNonEmptySubscriptionKeys();if(e.length!=this.lastSentSubscriptions.length)return  true;for(const t of e)if(!this.lastSentSubscriptions.includes(t))return  true;return  false}connectErrorHandler(e){if(clearTimeout(this.connectTimeoutId),clearTimeout(this.reconnectTimeoutId),!this.clientId&&!this.reconnectAttempts||this.reconnectAttempts>this.maxReconnectAttempts){for(let t of this.pendingConnects)t.reject(new ClientResponseError(e));return this.pendingConnects=[],void this.disconnect()}this.disconnect(true);const t=this.predefinedReconnectIntervals[this.reconnectAttempts]||this.predefinedReconnectIntervals[this.predefinedReconnectIntervals.length-1];this.reconnectAttempts++,this.reconnectTimeoutId=setTimeout((()=>{this.initConnect();}),t);}disconnect(e=false){if(this.clientId&&this.onDisconnect&&this.onDisconnect(Object.keys(this.subscriptions)),clearTimeout(this.connectTimeoutId),clearTimeout(this.reconnectTimeoutId),this.removeAllSubscriptionListeners(),this.client.cancelRequest(this.getSubscriptionsCancelKey()),this.eventSource?.close(),this.eventSource=null,this.clientId="",!e){this.reconnectAttempts=0;for(let e of this.pendingConnects)e.resolve();this.pendingConnects=[];}}}class CrudService extends BaseService{decode(e){return e}async getFullList(e,t){if("number"==typeof e)return this._getFullList(e,t);let s=500;return (t=Object.assign({},e,t)).batch&&(s=t.batch,delete t.batch),this._getFullList(s,t)}async getList(e=1,t=30,s){return (s=Object.assign({method:"GET"},s)).query=Object.assign({page:e,perPage:t},s.query),this.client.send(this.baseCrudPath,s).then((e=>(e.items=e.items?.map((e=>this.decode(e)))||[],e)))}async getFirstListItem(e,t){return (t=Object.assign({requestKey:"one_by_filter_"+this.baseCrudPath+"_"+e},t)).query=Object.assign({filter:e,skipTotal:1},t.query),this.getList(1,1,t).then((e=>{if(!e?.items?.length)throw new ClientResponseError({status:404,response:{code:404,message:"The requested resource wasn't found.",data:{}}});return e.items[0]}))}async getOne(e,t){if(!e)throw new ClientResponseError({url:this.client.buildURL(this.baseCrudPath+"/"),status:404,response:{code:404,message:"Missing required record id.",data:{}}});return t=Object.assign({method:"GET"},t),this.client.send(this.baseCrudPath+"/"+encodeURIComponent(e),t).then((e=>this.decode(e)))}async create(e,t){return t=Object.assign({method:"POST",body:e},t),this.client.send(this.baseCrudPath,t).then((e=>this.decode(e)))}async update(e,t,s){return s=Object.assign({method:"PATCH",body:t},s),this.client.send(this.baseCrudPath+"/"+encodeURIComponent(e),s).then((e=>this.decode(e)))}async delete(e,t){return t=Object.assign({method:"DELETE"},t),this.client.send(this.baseCrudPath+"/"+encodeURIComponent(e),t).then((()=>true))}_getFullList(e=500,t){(t=t||{}).query=Object.assign({skipTotal:1},t.query);let s=[],request=async i=>this.getList(i,e||500,t).then((e=>{const t=e.items;return s=s.concat(t),t.length==e.perPage?request(i+1):s}));return request(1)}}function normalizeLegacyOptionsArgs(e,t,s,i){const n=void 0!==i;return n||void 0!==s?n?(console.warn(e),t.body=Object.assign({},t.body,s),t.query=Object.assign({},t.query,i),t):Object.assign(t,s):t}function resetAutoRefresh(e){e._resetAutoRefresh?.();}class RecordService extends CrudService{constructor(e,t){super(e),this.collectionIdOrName=t;}get baseCrudPath(){return this.baseCollectionPath+"/records"}get baseCollectionPath(){return "/api/collections/"+encodeURIComponent(this.collectionIdOrName)}get isSuperusers(){return "_superusers"==this.collectionIdOrName||"_pbc_2773867675"==this.collectionIdOrName}async subscribe(e,t,s){if(!e)throw new Error("Missing topic.");if(!t)throw new Error("Missing subscription callback.");return this.client.realtime.subscribe(this.collectionIdOrName+"/"+e,t,s)}async unsubscribe(e){return e?this.client.realtime.unsubscribe(this.collectionIdOrName+"/"+e):this.client.realtime.unsubscribeByPrefix(this.collectionIdOrName)}async getFullList(e,t){if("number"==typeof e)return super.getFullList(e,t);const s=Object.assign({},e,t);return super.getFullList(s)}async getList(e=1,t=30,s){return super.getList(e,t,s)}async getFirstListItem(e,t){return super.getFirstListItem(e,t)}async getOne(e,t){return super.getOne(e,t)}async create(e,t){return super.create(e,t)}async update(e,t,s){return super.update(e,t,s).then((e=>{if(this.client.authStore.record?.id===e?.id&&(this.client.authStore.record?.collectionId===this.collectionIdOrName||this.client.authStore.record?.collectionName===this.collectionIdOrName)){let t=Object.assign({},this.client.authStore.record.expand),s=Object.assign({},this.client.authStore.record,e);t&&(s.expand=Object.assign(t,e.expand)),this.client.authStore.save(this.client.authStore.token,s);}return e}))}async delete(e,t){return super.delete(e,t).then((t=>(!t||this.client.authStore.record?.id!==e||this.client.authStore.record?.collectionId!==this.collectionIdOrName&&this.client.authStore.record?.collectionName!==this.collectionIdOrName||this.client.authStore.clear(),t)))}authResponse(e){const t=this.decode(e?.record||{});return this.client.authStore.save(e?.token,t),Object.assign({},e,{token:e?.token||"",record:t})}async listAuthMethods(e){return e=Object.assign({method:"GET",fields:"mfa,otp,password,oauth2"},e),this.client.send(this.baseCollectionPath+"/auth-methods",e)}async authWithPassword(e,t,s){let i;s=Object.assign({method:"POST",body:{identity:e,password:t}},s),this.isSuperusers&&(i=s.autoRefreshThreshold,delete s.autoRefreshThreshold,s.autoRefresh||resetAutoRefresh(this.client));let n=await this.client.send(this.baseCollectionPath+"/auth-with-password",s);return n=this.authResponse(n),i&&this.isSuperusers&&function registerAutoRefresh(e,t,s,i){resetAutoRefresh(e);const n=e.beforeSend,r=e.authStore.record,o=e.authStore.onChange(((t,s)=>{(!t||s?.id!=r?.id||(s?.collectionId||r?.collectionId)&&s?.collectionId!=r?.collectionId)&&resetAutoRefresh(e);}));e._resetAutoRefresh=function(){o(),e.beforeSend=n,delete e._resetAutoRefresh;},e.beforeSend=async(r,o)=>{const a=e.authStore.token;if(o.query?.autoRefresh)return n?n(r,o):{url:r,sendOptions:o};let c=e.authStore.isValid;if(c&&isTokenExpired(e.authStore.token,t))try{await s();}catch(e){c=false;}c||await i();const l=o.headers||{};for(let t in l)if("authorization"==t.toLowerCase()&&a==l[t]&&e.authStore.token){l[t]=e.authStore.token;break}return o.headers=l,n?n(r,o):{url:r,sendOptions:o}};}(this.client,i,(()=>this.authRefresh({autoRefresh:!0})),(()=>this.authWithPassword(e,t,Object.assign({autoRefresh:true},s)))),n}async authWithOAuth2Code(e,t,s,i,n,r,o){let a={method:"POST",body:{provider:e,code:t,codeVerifier:s,redirectURL:i,createData:n}};return a=normalizeLegacyOptionsArgs("This form of authWithOAuth2Code(provider, code, codeVerifier, redirectURL, createData?, body?, query?) is deprecated. Consider replacing it with authWithOAuth2Code(provider, code, codeVerifier, redirectURL, createData?, options?).",a,r,o),this.client.send(this.baseCollectionPath+"/auth-with-oauth2",a).then((e=>this.authResponse(e)))}authWithOAuth2(...e){if(e.length>1||"string"==typeof e?.[0])return console.warn("PocketBase: This form of authWithOAuth2() is deprecated and may get removed in the future. Please replace with authWithOAuth2Code() OR use the authWithOAuth2() realtime form as shown in https://pocketbase.io/docs/authentication/#oauth2-integration."),this.authWithOAuth2Code(e?.[0]||"",e?.[1]||"",e?.[2]||"",e?.[3]||"",e?.[4]||{},e?.[5]||{},e?.[6]||{});const t=e?.[0]||{};let s=null;t.urlCallback||(s=openBrowserPopup(void 0));const i=new RealtimeService(this.client);function cleanup(){s?.close(),i.unsubscribe();}const n={},r=t.requestKey;return r&&(n.requestKey=r),this.listAuthMethods(n).then((e=>{const n=e.oauth2.providers.find((e=>e.name===t.provider));if(!n)throw new ClientResponseError(new Error(`Missing or invalid provider "${t.provider}".`));const o=this.client.buildURL("/api/oauth2-redirect"),a=r?this.client.cancelControllers?.[r]:void 0;return a&&(a.signal.onabort=()=>{cleanup();}),new Promise((async(e,r)=>{try{await i.subscribe("@oauth2",(async s=>{const c=i.clientId;try{if(!s.state||c!==s.state)throw new Error("State parameters don't match.");if(s.error||!s.code)throw new Error("OAuth2 redirect error or missing code: "+s.error);const i=Object.assign({},t);delete i.provider,delete i.scopes,delete i.createData,delete i.urlCallback,a?.signal?.onabort&&(a.signal.onabort=null);const r=await this.authWithOAuth2Code(n.name,s.code,n.codeVerifier,o,t.createData,i);e(r);}catch(e){r(new ClientResponseError(e));}cleanup();}));const c={state:i.clientId};t.scopes?.length&&(c.scope=t.scopes.join(" "));const l=this._replaceQueryParams(n.authURL+o,c);let h=t.urlCallback||function(e){s?s.location.href=e:s=openBrowserPopup(e);};await h(l);}catch(e){cleanup(),r(new ClientResponseError(e));}}))})).catch((e=>{throw cleanup(),e}))}async authRefresh(e,t){let s={method:"POST"};return s=normalizeLegacyOptionsArgs("This form of authRefresh(body?, query?) is deprecated. Consider replacing it with authRefresh(options?).",s,e,t),this.client.send(this.baseCollectionPath+"/auth-refresh",s).then((e=>this.authResponse(e)))}async requestPasswordReset(e,t,s){let i={method:"POST",body:{email:e}};return i=normalizeLegacyOptionsArgs("This form of requestPasswordReset(email, body?, query?) is deprecated. Consider replacing it with requestPasswordReset(email, options?).",i,t,s),this.client.send(this.baseCollectionPath+"/request-password-reset",i).then((()=>true))}async confirmPasswordReset(e,t,s,i,n){let r={method:"POST",body:{token:e,password:t,passwordConfirm:s}};return r=normalizeLegacyOptionsArgs("This form of confirmPasswordReset(token, password, passwordConfirm, body?, query?) is deprecated. Consider replacing it with confirmPasswordReset(token, password, passwordConfirm, options?).",r,i,n),this.client.send(this.baseCollectionPath+"/confirm-password-reset",r).then((()=>true))}async requestVerification(e,t,s){let i={method:"POST",body:{email:e}};return i=normalizeLegacyOptionsArgs("This form of requestVerification(email, body?, query?) is deprecated. Consider replacing it with requestVerification(email, options?).",i,t,s),this.client.send(this.baseCollectionPath+"/request-verification",i).then((()=>true))}async confirmVerification(e,t,s){let i={method:"POST",body:{token:e}};return i=normalizeLegacyOptionsArgs("This form of confirmVerification(token, body?, query?) is deprecated. Consider replacing it with confirmVerification(token, options?).",i,t,s),this.client.send(this.baseCollectionPath+"/confirm-verification",i).then((()=>{const t=getTokenPayload(e),s=this.client.authStore.record;return s&&!s.verified&&s.id===t.id&&s.collectionId===t.collectionId&&(s.verified=true,this.client.authStore.save(this.client.authStore.token,s)),true}))}async requestEmailChange(e,t,s){let i={method:"POST",body:{newEmail:e}};return i=normalizeLegacyOptionsArgs("This form of requestEmailChange(newEmail, body?, query?) is deprecated. Consider replacing it with requestEmailChange(newEmail, options?).",i,t,s),this.client.send(this.baseCollectionPath+"/request-email-change",i).then((()=>true))}async confirmEmailChange(e,t,s,i){let n={method:"POST",body:{token:e,password:t}};return n=normalizeLegacyOptionsArgs("This form of confirmEmailChange(token, password, body?, query?) is deprecated. Consider replacing it with confirmEmailChange(token, password, options?).",n,s,i),this.client.send(this.baseCollectionPath+"/confirm-email-change",n).then((()=>{const t=getTokenPayload(e),s=this.client.authStore.record;return s&&s.id===t.id&&s.collectionId===t.collectionId&&this.client.authStore.clear(),true}))}async listExternalAuths(e,t){return this.client.collection("_externalAuths").getFullList(Object.assign({},t,{filter:this.client.filter("recordRef = {:id}",{id:e})}))}async unlinkExternalAuth(e,t,s){const i=await this.client.collection("_externalAuths").getFirstListItem(this.client.filter("recordRef = {:recordId} && provider = {:provider}",{recordId:e,provider:t}));return this.client.collection("_externalAuths").delete(i.id,s).then((()=>true))}async requestOTP(e,t){return t=Object.assign({method:"POST",body:{email:e}},t),this.client.send(this.baseCollectionPath+"/request-otp",t)}async authWithOTP(e,t,s){return s=Object.assign({method:"POST",body:{otpId:e,password:t}},s),this.client.send(this.baseCollectionPath+"/auth-with-otp",s).then((e=>this.authResponse(e)))}async impersonate(e,t,s){(s=Object.assign({method:"POST",body:{duration:t}},s)).headers=s.headers||{},s.headers.Authorization||(s.headers.Authorization=this.client.authStore.token);const i=new Client(this.client.baseURL,new BaseAuthStore,this.client.lang),n=await i.send(this.baseCollectionPath+"/impersonate/"+encodeURIComponent(e),s);return i.authStore.save(n?.token,this.decode(n?.record||{})),i}_replaceQueryParams(e,t={}){let s=e,i="";e.indexOf("?")>=0&&(s=e.substring(0,e.indexOf("?")),i=e.substring(e.indexOf("?")+1));const n={},r=i.split("&");for(const e of r){if(""==e)continue;const t=e.split("=");n[decodeURIComponent(t[0].replace(/\+/g," "))]=decodeURIComponent((t[1]||"").replace(/\+/g," "));}for(let e in t)t.hasOwnProperty(e)&&(null==t[e]?delete n[e]:n[e]=t[e]);i="";for(let e in n)n.hasOwnProperty(e)&&(""!=i&&(i+="&"),i+=encodeURIComponent(e.replace(/%20/g,"+"))+"="+encodeURIComponent(n[e].replace(/%20/g,"+")));return ""!=i?s+"?"+i:s}}function openBrowserPopup(e){if("undefined"==typeof window||!window?.open)throw new ClientResponseError(new Error("Not in a browser context - please pass a custom urlCallback function."));let t=1024,s=768,i=window.innerWidth,n=window.innerHeight;t=t>i?i:t,s=s>n?n:s;let r=i/2-t/2,o=n/2-s/2;return window.open(e,"popup_window","width="+t+",height="+s+",top="+o+",left="+r+",resizable,menubar=no")}class CollectionService extends CrudService{get baseCrudPath(){return "/api/collections"}async import(e,t=false,s){return s=Object.assign({method:"PUT",body:{collections:e,deleteMissing:t}},s),this.client.send(this.baseCrudPath+"/import",s).then((()=>true))}async getScaffolds(e){return e=Object.assign({method:"GET"},e),this.client.send(this.baseCrudPath+"/meta/scaffolds",e)}async truncate(e,t){return t=Object.assign({method:"DELETE"},t),this.client.send(this.baseCrudPath+"/"+encodeURIComponent(e)+"/truncate",t).then((()=>true))}}class LogService extends BaseService{async getList(e=1,t=30,s){return (s=Object.assign({method:"GET"},s)).query=Object.assign({page:e,perPage:t},s.query),this.client.send("/api/logs",s)}async getOne(e,t){if(!e)throw new ClientResponseError({url:this.client.buildURL("/api/logs/"),status:404,response:{code:404,message:"Missing required log id.",data:{}}});return t=Object.assign({method:"GET"},t),this.client.send("/api/logs/"+encodeURIComponent(e),t)}async getStats(e){return e=Object.assign({method:"GET"},e),this.client.send("/api/logs/stats",e)}}class HealthService extends BaseService{async check(e){return e=Object.assign({method:"GET"},e),this.client.send("/api/health",e)}}class FileService extends BaseService{getUrl(e,t,s={}){return console.warn("Please replace pb.files.getUrl() with pb.files.getURL()"),this.getURL(e,t,s)}getURL(e,t,s={}){if(!t||!e?.id||!e?.collectionId&&!e?.collectionName)return "";const i=[];i.push("api"),i.push("files"),i.push(encodeURIComponent(e.collectionId||e.collectionName)),i.push(encodeURIComponent(e.id)),i.push(encodeURIComponent(t));let n=this.client.buildURL(i.join("/"));if(Object.keys(s).length){ false===s.download&&delete s.download;const e=new URLSearchParams(s);n+=(n.includes("?")?"&":"?")+e;}return n}async getToken(e){return e=Object.assign({method:"POST"},e),this.client.send("/api/files/token",e).then((e=>e?.token||""))}}class BackupService extends BaseService{async getFullList(e){return e=Object.assign({method:"GET"},e),this.client.send("/api/backups",e)}async create(e,t){return t=Object.assign({method:"POST",body:{name:e}},t),this.client.send("/api/backups",t).then((()=>true))}async upload(e,t){return t=Object.assign({method:"POST",body:e},t),this.client.send("/api/backups/upload",t).then((()=>true))}async delete(e,t){return t=Object.assign({method:"DELETE"},t),this.client.send(`/api/backups/${encodeURIComponent(e)}`,t).then((()=>true))}async restore(e,t){return t=Object.assign({method:"POST"},t),this.client.send(`/api/backups/${encodeURIComponent(e)}/restore`,t).then((()=>true))}getDownloadUrl(e,t){return console.warn("Please replace pb.backups.getDownloadUrl() with pb.backups.getDownloadURL()"),this.getDownloadURL(e,t)}getDownloadURL(e,t){return this.client.buildURL(`/api/backups/${encodeURIComponent(t)}?token=${encodeURIComponent(e)}`)}}class CronService extends BaseService{async getFullList(e){return e=Object.assign({method:"GET"},e),this.client.send("/api/crons",e)}async run(e,t){return t=Object.assign({method:"POST"},t),this.client.send(`/api/crons/${encodeURIComponent(e)}`,t).then((()=>true))}}function isFile(e){return "undefined"!=typeof Blob&&e instanceof Blob||"undefined"!=typeof File&&e instanceof File||null!==e&&"object"==typeof e&&e.uri&&("undefined"!=typeof navigator&&"ReactNative"===navigator.product||"undefined"!=typeof global&&global.HermesInternal)}function isFormData(e){return e&&("FormData"===e.constructor?.name||"undefined"!=typeof FormData&&e instanceof FormData)}function hasFileField(e){for(const t in e){const s=Array.isArray(e[t])?e[t]:[e[t]];for(const e of s)if(isFile(e))return  true}return  false}const r=/^[\-\.\d]+$/;function inferFormDataValue(e){if("string"!=typeof e)return e;if("true"==e)return  true;if("false"==e)return  false;if(("-"===e[0]||e[0]>="0"&&e[0]<="9")&&r.test(e)){let t=+e;if(""+t===e)return t}return e}class BatchService extends BaseService{constructor(){super(...arguments),this.requests=[],this.subs={};}collection(e){return this.subs[e]||(this.subs[e]=new SubBatchService(this.requests,e)),this.subs[e]}async send(e){const t=new FormData,s=[];for(let e=0;e<this.requests.length;e++){const i=this.requests[e];if(s.push({method:i.method,url:i.url,headers:i.headers,body:i.json}),i.files)for(let s in i.files){const n=i.files[s]||[];for(let i of n)t.append("requests."+e+"."+s,i);}}return t.append("@jsonPayload",JSON.stringify({requests:s})),e=Object.assign({method:"POST",body:t},e),this.client.send("/api/batch",e)}}class SubBatchService{constructor(e,t){this.requests=[],this.requests=e,this.collectionIdOrName=t;}upsert(e,t){t=Object.assign({body:e||{}},t);const s={method:"PUT",url:"/api/collections/"+encodeURIComponent(this.collectionIdOrName)+"/records"};this.prepareRequest(s,t),this.requests.push(s);}create(e,t){t=Object.assign({body:e||{}},t);const s={method:"POST",url:"/api/collections/"+encodeURIComponent(this.collectionIdOrName)+"/records"};this.prepareRequest(s,t),this.requests.push(s);}update(e,t,s){s=Object.assign({body:t||{}},s);const i={method:"PATCH",url:"/api/collections/"+encodeURIComponent(this.collectionIdOrName)+"/records/"+encodeURIComponent(e)};this.prepareRequest(i,s),this.requests.push(i);}delete(e,t){t=Object.assign({},t);const s={method:"DELETE",url:"/api/collections/"+encodeURIComponent(this.collectionIdOrName)+"/records/"+encodeURIComponent(e)};this.prepareRequest(s,t),this.requests.push(s);}prepareRequest(e,t){if(normalizeUnknownQueryParams(t),e.headers=t.headers,e.json={},e.files={},void 0!==t.query){const s=serializeQueryParams(t.query);s&&(e.url+=(e.url.includes("?")?"&":"?")+s);}let s=t.body;isFormData(s)&&(s=function convertFormDataToObject(e){let t={};return e.forEach(((e,s)=>{if("@jsonPayload"===s&&"string"==typeof e)try{let s=JSON.parse(e);Object.assign(t,s);}catch(e){console.warn("@jsonPayload error:",e);}else void 0!==t[s]?(Array.isArray(t[s])||(t[s]=[t[s]]),t[s].push(inferFormDataValue(e))):t[s]=inferFormDataValue(e);})),t}(s));for(const t in s){const i=s[t];if(isFile(i))e.files[t]=e.files[t]||[],e.files[t].push(i);else if(Array.isArray(i)){const s=[],n=[];for(const e of i)isFile(e)?s.push(e):n.push(e);if(s.length>0&&s.length==i.length){e.files[t]=e.files[t]||[];for(let i of s)e.files[t].push(i);}else if(e.json[t]=n,s.length>0){let i=t;t.startsWith("+")||t.endsWith("+")||(i+="+"),e.files[i]=e.files[i]||[];for(let t of s)e.files[i].push(t);}}else e.json[t]=i;}}}class Client{get baseUrl(){return this.baseURL}set baseUrl(e){this.baseURL=e;}constructor(e="/",t,s="en-US"){this.cancelControllers={},this.recordServices={},this.enableAutoCancellation=true,this.baseURL=e,this.lang=s,t?this.authStore=t:"undefined"!=typeof window&&window.Deno?this.authStore=new BaseAuthStore:this.authStore=new LocalAuthStore,this.collections=new CollectionService(this),this.files=new FileService(this),this.logs=new LogService(this),this.settings=new SettingsService(this),this.realtime=new RealtimeService(this),this.health=new HealthService(this),this.backups=new BackupService(this),this.crons=new CronService(this);}get admins(){return this.collection("_superusers")}createBatch(){return new BatchService(this)}collection(e){return this.recordServices[e]||(this.recordServices[e]=new RecordService(this,e)),this.recordServices[e]}autoCancellation(e){return this.enableAutoCancellation=!!e,this}cancelRequest(e){return this.cancelControllers[e]&&(this.cancelControllers[e].abort(),delete this.cancelControllers[e]),this}cancelAllRequests(){for(let e in this.cancelControllers)this.cancelControllers[e].abort();return this.cancelControllers={},this}filter(e,t){if(!t)return e;for(let s in t){let i=t[s];switch(typeof i){case "boolean":case "number":i=""+i;break;case "string":i="'"+i.replace(/'/g,"\\'")+"'";break;default:i=null===i?"null":i instanceof Date?"'"+i.toISOString().replace("T"," ")+"'":"'"+JSON.stringify(i).replace(/'/g,"\\'")+"'";}e=e.replaceAll("{:"+s+"}",i);}return e}getFileUrl(e,t,s={}){return console.warn("Please replace pb.getFileUrl() with pb.files.getURL()"),this.files.getURL(e,t,s)}buildUrl(e){return console.warn("Please replace pb.buildUrl() with pb.buildURL()"),this.buildURL(e)}buildURL(e){let t=this.baseURL;return "undefined"==typeof window||!window.location||t.startsWith("https://")||t.startsWith("http://")||(t=window.location.origin?.endsWith("/")?window.location.origin.substring(0,window.location.origin.length-1):window.location.origin||"",this.baseURL.startsWith("/")||(t+=window.location.pathname||"/",t+=t.endsWith("/")?"":"/"),t+=this.baseURL),e&&(t+=t.endsWith("/")?"":"/",t+=e.startsWith("/")?e.substring(1):e),t}async send(e,t){t=this.initSendOptions(e,t);let s=this.buildURL(e);if(this.beforeSend){const e=Object.assign({},await this.beforeSend(s,t));void 0!==e.url||void 0!==e.options?(s=e.url||s,t=e.options||t):Object.keys(e).length&&(t=e,console?.warn&&console.warn("Deprecated format of beforeSend return: please use `return { url, options }`, instead of `return options`."));}if(void 0!==t.query){const e=serializeQueryParams(t.query);e&&(s+=(s.includes("?")?"&":"?")+e),delete t.query;}"application/json"==this.getHeader(t.headers,"Content-Type")&&t.body&&"string"!=typeof t.body&&(t.body=JSON.stringify(t.body));return (t.fetch||fetch)(s,t).then((async e=>{let s={};try{s=await e.json();}catch(e){if(t.signal?.aborted||"undefined"!=typeof DOMException&&e instanceof DOMException&&("AbortError"==e.name||20==e.code))throw e}if(this.afterSend&&(s=await this.afterSend(e,s,t)),e.status>=400)throw new ClientResponseError({url:e.url,status:e.status,data:s});return s})).catch((e=>{throw new ClientResponseError(e)}))}initSendOptions(e,t){if((t=Object.assign({method:"GET"},t)).body=function convertToFormDataIfNeeded(e){if("undefined"==typeof FormData||void 0===e||"object"!=typeof e||null===e||isFormData(e)||!hasFileField(e))return e;const t=new FormData;for(const s in e){const i=e[s];if(void 0!==i)if("object"!=typeof i||hasFileField({data:i})){const e=Array.isArray(i)?i:[i];for(let i of e)t.append(s,i);}else {let e={};e[s]=i,t.append("@jsonPayload",JSON.stringify(e));}}return t}(t.body),normalizeUnknownQueryParams(t),t.query=Object.assign({},t.params,t.query),void 0===t.requestKey&&(false===t.$autoCancel||false===t.query.$autoCancel?t.requestKey=null:(t.$cancelKey||t.query.$cancelKey)&&(t.requestKey=t.$cancelKey||t.query.$cancelKey)),delete t.$autoCancel,delete t.query.$autoCancel,delete t.$cancelKey,delete t.query.$cancelKey,null!==this.getHeader(t.headers,"Content-Type")||isFormData(t.body)||(t.headers=Object.assign({},t.headers,{"Content-Type":"application/json"})),null===this.getHeader(t.headers,"Accept-Language")&&(t.headers=Object.assign({},t.headers,{"Accept-Language":this.lang})),this.authStore.token&&null===this.getHeader(t.headers,"Authorization")&&(t.headers=Object.assign({},t.headers,{Authorization:this.authStore.token})),this.enableAutoCancellation&&null!==t.requestKey){const s=t.requestKey||(t.method||"GET")+e;delete t.requestKey,this.cancelRequest(s);const i=new AbortController;this.cancelControllers[s]=i,t.signal=i.signal;}return t}getHeader(e,t){e=e||{},t=t.toLowerCase();for(let s in e)if(s.toLowerCase()==t)return e[s];return null}}

    // Internal state
    let pb = null;
    let dbUrl = typeof window !== 'undefined' ? window.location.origin : '';
    let dbAutoCancellation = false;
    const realtimeUnsubscribers = new Map();
    const realtimeRecordUnsubscribers = new Map(); // Key: "collection:id"
    /**
     * Get or create the PocketBase instance
     */
    function getClient() {
        if (!pb) {
            pb = new Client(dbUrl);
            // Disable auto-cancellation by default (can be overridden via db.autoCancellation)
            pb.autoCancellation(dbAutoCancellation);
            // Listen for auth changes
            pb.authStore.onChange(() => {
                saveAuthState();
                events.emit('auth:change', {
                    user: pb?.authStore.record,
                    isAuthenticated: pb?.authStore.isValid ?? false
                });
            });
            // Restore auth from previous session
            restoreAuthState();
        }
        return pb;
    }
    /**
     * Save auth state to local storage
     */
    function saveAuthState() {
        if (!pb)
            return;
        if (pb.authStore.isValid) {
            const user = pb.authStore.record;
            state.set('_auth:token', pb.authStore.token, { persist: 'local' });
            state.set('_auth:user', user, { persist: 'local' });
        }
        else {
            state.remove('_auth:token');
            state.remove('_auth:user');
        }
    }
    /**
     * Restore auth state from local storage
     */
    function restoreAuthState() {
        if (!pb)
            return;
        const token = state.get('_auth:token');
        const user = state.get('_auth:user');
        if (token && user) {
            pb.authStore.save(token, user);
        }
    }
    /**
     * Enable realtime for a collection (called by events module)
     */
    async function enableRealtime(collection) {
        if (realtimeUnsubscribers.has(collection))
            return;
        const client = getClient();
        const unsubscribe = await client.collection(collection).subscribe('*', (e) => {
            events.emit(`db:${collection}:${e.action}`, { record: e.record });
        });
        realtimeUnsubscribers.set(collection, unsubscribe);
    }
    /**
     * Disable realtime for a collection (called by events module)
     */
    async function disableRealtime(collection) {
        const unsubscribe = realtimeUnsubscribers.get(collection);
        if (unsubscribe) {
            unsubscribe();
            realtimeUnsubscribers.delete(collection);
        }
    }
    /**
     * Enable realtime for a specific record (called by events module)
     */
    async function enableRealtimeRecord(collection, id) {
        const key = `${collection}:${id}`;
        if (realtimeRecordUnsubscribers.has(key))
            return;
        const client = getClient();
        const unsubscribe = await client.collection(collection).subscribe(id, (e) => {
            events.emit(`db:${collection}:${e.action}:${id}`, { record: e.record });
        });
        realtimeRecordUnsubscribers.set(key, unsubscribe);
    }
    /**
     * Disable realtime for a specific record (called by events module)
     */
    async function disableRealtimeRecord(collection, id) {
        const key = `${collection}:${id}`;
        const unsubscribe = realtimeRecordUnsubscribers.get(key);
        if (unsubscribe) {
            unsubscribe();
            realtimeRecordUnsubscribers.delete(key);
        }
    }
    // Register with events module
    setDbModule({ enableRealtime, disableRealtime, enableRealtimeRecord, disableRealtimeRecord });
    const db = {
        /**
         * Get or set the PocketBase URL
         * Defaults to window.location.origin
         */
        get url() {
            return dbUrl;
        },
        set url(value) {
            dbUrl = value;
            // Reset client so it reconnects with new URL
            if (pb) {
                pb = null;
            }
        },
        /**
         * Get or set auto-cancellation behavior
         * Defaults to false (disabled)
         */
        get autoCancellation() {
            return dbAutoCancellation;
        },
        set autoCancellation(value) {
            dbAutoCancellation = value;
            // Apply to existing client if any
            if (pb) {
                pb.autoCancellation(value);
            }
        },
        /**
         * Get the underlying PocketBase instance for advanced usage
         */
        client() {
            return getClient();
        },
        /**
         * Check if user is authenticated
         */
        isAuthenticated() {
            return getClient().authStore.isValid;
        },
        /**
         * Get current authenticated user
         */
        getUser() {
            return getClient().authStore.record ?? null;
        },
        // ==================== AUTH ====================
        /**
         * Sign up a new user
         */
        async signup(email, password, data = {}) {
            const client = getClient();
            const user = await client.collection('users').create({
                email,
                password,
                passwordConfirm: password,
                ...data
            });
            events.emit('auth:signup', { user });
            return user;
        },
        /**
         * Log in with email and password
         */
        async login(email, password) {
            const client = getClient();
            const auth = await client.collection('users').authWithPassword(email, password);
            events.emit('auth:login', { user: auth.record });
            return auth.record;
        },
        /**
         * Log in with OAuth2 provider
         */
        async loginWithOAuth(provider) {
            const client = getClient();
            const auth = await client.collection('users').authWithOAuth2({ provider });
            events.emit('auth:login', { user: auth.record });
            return auth.record;
        },
        /**
         * Log out the current user
         */
        logout() {
            const user = this.getUser();
            const client = getClient();
            client.authStore.clear();
            state.remove('_auth:token');
            state.remove('_auth:user');
            events.emit('auth:logout', { user });
        },
        /**
         * Refresh the auth token
         */
        async refreshAuth() {
            const client = getClient();
            const auth = await client.collection('users').authRefresh();
            events.emit('auth:refresh', { user: auth.record });
            return auth.record;
        },
        /**
         * Request a password reset email
         */
        async resetPassword(email) {
            const client = getClient();
            await client.collection('users').requestPasswordReset(email);
            events.emit('auth:reset-request', { email });
        },
        /**
         * Confirm a password reset
         */
        async confirmResetPassword(token, password) {
            const client = getClient();
            await client.collection('users').confirmPasswordReset(token, password, password);
            events.emit('auth:reset-confirm', {});
        },
        /**
         * Request email verification
         */
        async requestVerification(email) {
            const client = getClient();
            await client.collection('users').requestVerification(email);
            events.emit('auth:verify-request', { email });
        },
        /**
         * Confirm email verification
         */
        async confirmVerification(token) {
            const client = getClient();
            await client.collection('users').confirmVerification(token);
            events.emit('auth:verify-confirm', {});
        },
        // ==================== CRUD ====================
        /**
         * Get a single record by ID
         */
        async get(collection, id, options = {}) {
            const client = getClient();
            return client.collection(collection).getOne(id, options);
        },
        /**
         * List records with pagination
         */
        async list(collection, options = {}) {
            const client = getClient();
            const { page = 1, perPage = 20, ...rest } = options;
            return client.collection(collection).getList(page, perPage, rest);
        },
        /**
         * Get all records (auto-paginated)
         */
        async getAll(collection, options = {}) {
            const client = getClient();
            return client.collection(collection).getFullList(options);
        },
        /**
         * Get the first record matching a filter
         */
        async getFirst(collection, filter, options = {}) {
            const client = getClient();
            try {
                return await client.collection(collection).getFirstListItem(filter, options);
            }
            catch {
                return null;
            }
        },
        /**
         * Create a new record
         * Data can be a plain object or FormData (for file uploads)
         */
        async create(collection, data, options = {}) {
            const client = getClient();
            const record = await client.collection(collection).create(data, options);
            events.emit(`db:${collection}:create`, { record });
            return record;
        },
        /**
         * Update an existing record
         * Data can be a plain object or FormData (for file uploads)
         */
        async update(collection, id, data, options = {}) {
            const client = getClient();
            const record = await client.collection(collection).update(id, data, options);
            events.emit(`db:${collection}:update`, { record });
            return record;
        },
        /**
         * Delete a record
         */
        async delete(collection, id) {
            const client = getClient();
            await client.collection(collection).delete(id);
            events.emit(`db:${collection}:delete`, { id });
        },
        // ==================== FILES ====================
        /**
         * Get a file URL from a record
         */
        getFileUrl(record, filename, options = {}) {
            const client = getClient();
            return client.files.getURL(record, filename, options);
        }
    };

    const cc = {
        state,
        events,
        db
    };
    // Auto-attach to window in browser environments
    if (typeof window !== 'undefined') {
        window.cc = cc;
    }

    exports.cc = cc;
    exports.db = db;
    exports.default = cc;
    exports.events = events;
    exports.state = state;

    Object.defineProperty(exports, '__esModule', { value: true });

}));
//# sourceMappingURL=connect.js.map
