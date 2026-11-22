import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

// Invite-only: users are created by admins (AdminCreateUser). The only other way in is a
// first-time federated (Google) login, which we allow only if an invited user with that
// verified email already exists.
export async function handler(event) {
  switch (event.triggerSource) {
    case "PreSignUp_AdminCreateUser":
      return event;
    case "PreSignUp_ExternalProvider": {
      const attrs = event.request.userAttributes;
      const email = String(attrs.email ?? "").toLowerCase();
      if (!email || String(attrs.email_verified) !== "true") throw new Error("Unverified email");
      const { Users = [] } = await cognito.send(new ListUsersCommand({
        UserPoolId: event.userPoolId,
        Filter: `email = "${email.replace(/["\\]/g, "")}"`,
        Limit: 10,
      }));
      if (!Users.some((u) => u.UserStatus !== "EXTERNAL_PROVIDER")) {
        throw new Error("This email has not been invited");
      }
      return event;
    }
    default:
      throw new Error("Sign-up is by invitation only");
  }
}
