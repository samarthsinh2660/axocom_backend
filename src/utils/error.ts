export class RequestError extends Error {
    code: number;
    statusCode: number;

    constructor(message: string, code: number, statusCode: number) {
        super(message);
        this.name = 'RequestError';
        this.code = code;
        this.statusCode = statusCode;

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RequestError);
        }
    }
}

/*
HTTP Status Codes Reference:
200 OK - Response to a successful GET, PUT, PATCH or DELETE
201 Created - Response to a POST that results in a creation
204 No Content - Response to a successful request that won't be returning a body
304 Not Modified - Used when HTTP caching headers are in play
400 Bad Request - The request is malformed, such as if the body does not parse
401 Unauthorized - When no or invalid authentication details are provided
403 Forbidden - When authentication succeeded but authenticated user doesn't have access to the resource
404 Not Found - When a non-existent resource is requested
405 Method Not Allowed - When an HTTP method is being requested that isn't allowed for the authenticated user
410 Gone - Indicates that the resource at this end point is no longer available
415 Unsupported Media Type - If incorrect content type was provided as part of the request
422 Unprocessable Entity - Used for validation errors
429 Too Many Requests - When a request is rejected due to rate limiting
500 Internal Server Error - This is either a system or application error
503 Service Unavailable - The server is unable to handle the request for a service due to temporary maintenance
*/

/*
Error Code Convention:
- 1xxxx: Common/General errors
- 2xxxx: Authentication & Authorization errors  
- 3xxxx: Neta service errors
- 4xxxx: Voter service errors
- 5xxxx: -- service errors
- 6xxxx: -- Story service errors
- 7xxxx: -- service errors
- 8xxxx: -- service errors
*/

export const ERRORS = {
    // Common Errors (1xxxx)
    DATABASE_ERROR: new RequestError("Database operation failed", 10001, 500),
    INVALID_REQUEST_BODY: new RequestError("Invalid request body", 10002, 400),
    INVALID_QUERY_PARAMETER: new RequestError("Invalid query parameters", 10003, 400),
    UNHANDLED_ERROR: new RequestError("An unexpected error occurred", 10004, 500),
    INTERNAL_SERVER_ERROR: new RequestError("Internal server error", 10005, 500),
    FILE_NOT_FOUND: new RequestError("File not found", 10006, 404),
    INVALID_PARAMS: new RequestError("Invalid parameters", 10007, 400),
    VALIDATION_ERROR: new RequestError("Validation failed", 10008, 422),
    RESOURCE_NOT_FOUND: new RequestError("Resource not found", 10009, 404),
    DUPLICATE_RESOURCE: new RequestError("Resource already exists", 10010, 409),
    INVALID_AUTHOR_ID: new RequestError("Invalid author ID", 10011, 400),


    // Authentication & Authorization Errors (2xxxx)
    NO_TOKEN_PROVIDED: new RequestError("No authentication token provided", 20001, 401),
    INVALID_AUTH_TOKEN: new RequestError("Invalid authentication token", 20002, 401),
    TOKEN_EXPIRED: new RequestError("Authentication token has expired", 20003, 401),
    INVALID_REFRESH_TOKEN: new RequestError("Invalid refresh token", 20004, 401),
    UNAUTHORIZED: new RequestError("Unauthorized access", 20005, 401),
    FORBIDDEN: new RequestError("Access forbidden", 20006, 403),
    ADMIN_ONLY_ROUTE: new RequestError("Admin access required", 20007, 403),
    JWT_SECRET_NOT_CONFIGURED: new RequestError("JWT configuration error", 20008, 500),
    INSUFFICIENT_PERMISSIONS: new RequestError("Insufficient permissions", 20009, 403),
    USER_NOT_FOUND: new RequestError("User not found", 20010, 404),
    // New OTP related errors
    INVALID_OTP: new RequestError("Invalid or expired OTP", 20010, 400),
    OTP_EXPIRED: new RequestError("OTP has expired", 20011, 400),
    PASSWORD_TOO_SHORT: new RequestError("Password must be at least 6 characters long", 20012, 400),
    OTP_SEND_FAILED: new RequestError("Failed to send OTP", 20013, 500,),

    // Candidate Service Errors (3xxxx)
    CANDIDATE_NOT_FOUND: new RequestError("Candidate not found", 30001, 404),
    CANDIDATE_CREATION_FAILED: new RequestError("Failed to create candidate", 30002, 500),

    // Admin Service Errors (4xxxx)
    ADMIN_EMAIL_EXISTS: new RequestError("Admin email already exists", 40001, 409),
    ADMIN_USERNAME_EXISTS: new RequestError("Admin username already exists", 40002, 409),
    ADMIN_NOT_FOUND: new RequestError("Admin not found", 40003, 404),
    INVALID_ADMIN_CREDENTIALS: new RequestError("Invalid email or password", 40004, 401),
    ADMIN_CREATION_FAILED: new RequestError("Failed to create admin account", 40006, 500),
    ADMIN_ACCOUNT_DISABLED: new RequestError("Admin account is disabled", 40007, 403),

    // Voter Service Errors (5xxxx)
    VOTER_NOT_FOUND: new RequestError("Voter not found", 50001, 404),
    PARTY_NOT_FOUND: new RequestError("Party not found", 50002, 404),
    CONSTITUENCY_NOT_FOUND: new RequestError("Constituency not found", 50003, 404),
    ELECTION_CANDIDATE_NOT_FOUND: new RequestError("Election candidate not found", 50004, 404),
    ELECTION_RESULT_NOT_FOUND: new RequestError("Election result not found", 50005, 404),
    ELECTION_NOT_FOUND: new RequestError("Election not found", 50006, 404),
    USER_ALREADY_EXISTS: new RequestError("User already exists", 50007, 409),

    // Hackathon submission errors (6xxxx)
    DUPLICATE_SUBMISSION: new RequestError("An entry already exists for this email or phone", 60001, 409),
    SOLUTION_NOT_FOUND: new RequestError("Solution submission not found", 60003, 404),
    MENTOR_NOT_FOUND: new RequestError("Mentor application not found", 60004, 404),
    INVALID_REVIEW_STATUS: new RequestError("Invalid review status", 60005, 400),


};

export function isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;

    const databaseError = error as { code?: string; errno?: number; message?: string };
    return databaseError.code === "ER_DUP_ENTRY"
        || databaseError.errno === 1062
        || databaseError.message?.includes("Duplicate entry") === true;
}

// Helper function to check if error is a RequestError
export function isRequestError(error: any): error is RequestError {
    return error instanceof RequestError;
}

// Helper function to handle unknown errors
export function handleUnknownError(error: any): RequestError {
    if (isRequestError(error)) {
        return error;
    }

    console.error('Unknown error:', error);
    return ERRORS.UNHANDLED_ERROR;
}