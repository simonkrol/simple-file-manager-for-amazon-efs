class Role {
    constructor(name, regex, priority, access) {
        this.name = name;
        this.regex = regex; // Regex to match against the group name
        this.priority = priority; // Priority is used to determine which role to use when a user is in multiple groups (Higher priority wins)
        this.access = access;
    }

    hasAccess(method) {
        return this.access[method];
    }
}

// These access levels are used solely for displaying on the frontend, API permissions are managed by the IAM roles defined on the Cognito Users
export default {
    ADMIN: new Role('admin', /.*Admins$/, 2, {GET: true, POST: true, PUT: true, DELETE: true}),
    USER: new Role('user', /.*Users$/, 1, {GET: true, POST: false, PUT: false, DELETE: false})
}