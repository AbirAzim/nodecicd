# OIDC Deploy Job

The `deploy` job to use when deploying with **OIDC + SSM** (no SSH key, port 22 closed).

Before using it, finish the AWS setup in [oidc-deploy.md](oidc-deploy.md) (Steps 1–6). The job needs these 3 GitHub secrets:

| Secret | Example |
| ------ | ------- |
| `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/github-deploy-role` |
| `AWS_REGION` | `ap-south-1` |
| `EC2_INSTANCE_ID` | `i-0abc123def456789` |

---

## The deploy job

Add this at the bottom of `.github/workflows/build-deploy.yaml`, after the `build` job. Keep the same indentation as `test:` and `build:` (2 spaces). If you already added the SSH `deploy` job, **replace** it with this one.

```yaml
  deploy:
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Log in to AWS with OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Send deploy command to EC2
        id: deploy
        run: |
          COMMAND_ID=$(aws ssm send-command \
            --instance-ids "${{ secrets.EC2_INSTANCE_ID }}" \
            --document-name "AWS-RunShellScript" \
            --comment "Deploy ${{ github.sha }}" \
            --parameters 'commands=["set -e","cd /home/ec2-user/nodecicd","sudo -u ec2-user git pull","docker compose up -d --build"]' \
            --query "Command.CommandId" \
            --output text)
          echo "command_id=$COMMAND_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for deploy and show output
        run: |
          aws ssm wait command-executed \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" || true

          aws ssm get-command-invocation \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" \
            --query "[Status, StandardOutputContent, StandardErrorContent]" \
            --output text

          STATUS=$(aws ssm get-command-invocation \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" \
            --query "Status" \
            --output text)
          [ "$STATUS" = "Success" ]
```

---

## What it does, in order

```
1. Log in to AWS        GitHub proves "I'm AbirAzim/nodecicd on main" → AWS gives temporary credentials
2. Send deploy command  Ask SSM to run 4 commands on EC2 → get back a command ID
3. Wait and show output Wait for EC2 to finish → print its output → pass ✅ or fail ❌
```

### Job settings

| Line | Meaning |
| ---- | ------- |
| `needs: build` | Only deploy if `test` and `build` passed |
| `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` | Only deploy on a push to `main`. Pull requests still run test and build, but deploy is skipped. |
| `runs-on: ubuntu-latest` | A fresh Linux computer for this job |
| `permissions: id-token: write` | **Required for OIDC.** Lets the job ask GitHub for the signed proof of who it is. Without it, the login step fails. |
| `permissions: contents: read` | Lets the job read the repo. Once you list any `permissions`, everything else is turned off, so this has to be added back. |

**There's no `checkout code` step.** This job never touches your files. EC2 downloads the code itself with `git pull`.

### Step 1: Log in to AWS with OIDC

| Line | Meaning |
| ---- | ------- |
| `uses: aws-actions/configure-aws-credentials@v4` | AWS's official login action. It does the whole OIDC exchange for you. |
| `role-to-assume` | Which IAM role to log in as (`github-deploy-role`) |
| `aws-region` | Which AWS region your EC2 is in |

After this step, every `aws` command in the job is logged in automatically, with credentials that expire in about an hour. **No access keys appear anywhere.**

### Step 2: Send deploy command to EC2

| Part | Meaning |
| ---- | ------- |
| `id: deploy` | A name for this step, so the next step can read its output |
| `aws ssm send-command` | "SSM, please run commands on a server" |
| `--instance-ids` | Which server |
| `--document-name "AWS-RunShellScript"` | Run them as Linux shell commands |
| `--comment "Deploy ${{ github.sha }}"` | A label with the commit ID, shown in **Systems Manager → Run Command** |
| `--parameters 'commands=[...]'` | The commands to run (see below) |
| `--query "Command.CommandId" --output text` | From AWS's response, print only the command ID |
| `COMMAND_ID=$(...)` | Save that ID in a variable |
| `echo "command_id=$COMMAND_ID" >> "$GITHUB_OUTPUT"` | Hand the ID to the next step. Steps can't share shell variables; this is how one step passes a value to another. |

The `\` at the end of a line means "the command continues on the next line".

**The commands that run on EC2:**

| # | Command | Meaning |
| - | ------- | ------- |
| 1 | `set -e` | Stop at the first error, so a failed `git pull` doesn't deploy old code and report success |
| 2 | `cd /home/ec2-user/nodecicd` | Go to the repo you cloned on EC2 |
| 3 | `sudo -u ec2-user git pull` | Download the latest code **as `ec2-user`**. SSM runs commands as root, and git refuses to work in a folder owned by another user (`dubious ownership`). |
| 4 | `docker compose up -d --build` | Rebuild the image with the new code (`--build`) and restart the container in the background (`-d`) |

### Step 3: Wait for deploy and show output

`send-command` only **starts** the commands. It returns right away without waiting. This step waits and reports the result.

| Part | Meaning |
| ---- | ------- |
| `aws ssm wait command-executed ...` | Check every 5 seconds until EC2 finishes (gives up after ~100 seconds) |
| `\|\| true` | Don't stop here if waiting fails. Show the output first, then decide. |
| `aws ssm get-command-invocation ... --query "[Status, StandardOutputContent, StandardErrorContent]"` | Print the status and everything EC2 printed, including Docker's build log |
| `STATUS=$(...)` | Get just the status, e.g. `Success` or `Failed` |
| `[ "$STATUS" = "Success" ]` | The final check. Anything other than `Success` fails the job, so you get a ❌ instead of a false ✅. |

`${{ steps.deploy.outputs.command_id }}` reads the ID that Step 2 saved: `deploy` is Step 2's `id`, and `command_id` is the name it was saved under.

---

## The full workflow file

This is the whole `.github/workflows/build-deploy.yaml` with the OIDC deploy job added:

```yaml
name: deploy simple-node to ec2

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: checkout code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: checkout code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Check docker compose config
        run: docker compose config

      - name: Build Docker image
        run: docker compose build

  deploy:
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Log in to AWS with OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Send deploy command to EC2
        id: deploy
        run: |
          COMMAND_ID=$(aws ssm send-command \
            --instance-ids "${{ secrets.EC2_INSTANCE_ID }}" \
            --document-name "AWS-RunShellScript" \
            --comment "Deploy ${{ github.sha }}" \
            --parameters 'commands=["set -e","cd /home/ec2-user/nodecicd","sudo -u ec2-user git pull","docker compose up -d --build"]' \
            --query "Command.CommandId" \
            --output text)
          echo "command_id=$COMMAND_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for deploy and show output
        run: |
          aws ssm wait command-executed \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" || true

          aws ssm get-command-invocation \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" \
            --query "[Status, StandardOutputContent, StandardErrorContent]" \
            --output text

          STATUS=$(aws ssm get-command-invocation \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" \
            --query "Status" \
            --output text)
          [ "$STATUS" = "Success" ]
```

---

## SSH deploy job vs OIDC deploy job

| | SSH ([deploy-job.md](deploy-job.md)) | OIDC ([this file](oidc-deploy-job.md)) |
| --- | --- | --- |
| `permissions: id-token: write` | Not needed | **Required** |
| `checkout code` step | Yes, to copy the files | **No**, EC2 runs `git pull` |
| How it logs in | Writes the `.pem` key to a file | `configure-aws-credentials` action |
| How it runs commands | `ssh ... "docker compose up"` | `aws ssm send-command` |
| How code reaches EC2 | `scp` | `git pull` on EC2 |
| Secrets | `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` | `AWS_ROLE_ARN`, `AWS_REGION`, `EC2_INSTANCE_ID` |

For errors and fixes, see the troubleshooting table at the end of [oidc-deploy.md](oidc-deploy.md).
