#!/usr/bin/env bash
# Usage: register.sh <task-family-suffix> <image-app>
# Copies the current task definition with this commit's image and registers it as a new revision.
set -euo pipefail
: "${NAME:?}" "${GITHUB_SHA:?}" "${AWS_REGION:?}"
family="$NAME-$1"; app="$2"
registry="$(aws sts get-caller-identity --query Account --output text).dkr.ecr.${AWS_REGION}.amazonaws.com"
aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json \
  | jq --arg img "$registry/$NAME/$app:$GITHUB_SHA" \
      'del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy) | .containerDefinitions[0].image = $img' \
  > /tmp/taskdef.json
aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json --query 'taskDefinition.revision' --output text
