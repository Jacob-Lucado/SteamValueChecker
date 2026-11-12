// The error the dashboard's route handlers throw; the server turns it into a response with this status.
export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
