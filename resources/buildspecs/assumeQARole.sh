CRED=`aws sts assume-role --role-arn arn:aws:iam::$QA_ACCOUNT:role/$QA_ROLE_NAME --role-session-name cicd-access` && 
echo $CRED && 
export AWS_ACCESS_KEY_ID=`node -pe 'JSON.parse(process.argv[1]).Credentials.AccessKeyId' "$CRED"` && 
export AWS_SECRET_ACCESS_KEY=`node -pe 'JSON.parse(process.argv[1]).Credentials.SecretAccessKey' "$CRED"` && 
export AWS_SESSION_TOKEN=`node -pe 'JSON.parse(process.argv[1]).Credentials.SessionToken' "$CRED"` && 
export AWS_EXPIRATION=`node -pe 'JSON.parse(process.argv[1]).Credentials.Expiration' "$CRED"`