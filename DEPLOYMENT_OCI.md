# OCI Deployment Plan & Checklist

This guide outlines the steps to move the **Tee Time Notifier** backend from local development to a production environment on **Oracle Cloud Infrastructure (OCI)**.

## I. Infrastructure Setup (OCI)

1.  **Create Compute Instance**:
    *   **Image**: Ubuntu 22.04 or 24.04 (Standard x86_64).
    *   **Shape**: `VM.Standard.E2.1.Micro` (Always Free).
2.  **Virtual Cloud Network (VCN) Configuration**:
    *   Reusing existing VCN/Subnet is recommended.
    *   Ensure **Ingress Rules** are added to the Security List:
        *   `0.0.0.0/0`, Protocol: `TCP`, Destination Port: `80`, `443`.
3.  **Assign Reserved Public IP**: Verify the instance has a static public IP assigned.

## II. Local SSH Setup (Pro Tips)

To make accessing your instance easy without typing the long IP and key path every time:

1.  **Key Location**: Move your `.key` or `.pem` file to `~/.ssh/`.
    ```bash
    mv ~/Downloads/your-oci-key.key ~/.ssh/oci_tee_time.key
    chmod 600 ~/.ssh/oci_tee_time.key
    ```
2.  **Edit SSH Config**:
    Open `~/.ssh/config` (create it if it doesn't exist) and add:
    ```text
    Host tee-time
        HostName <your-oci-public-ip>
        User ubuntu
        IdentityFile ~/.ssh/oci_tee_time.key
    ```
3.  **Shortcut**: Now you can simply run `ssh tee-time` to log in.

## III. Code Transfer

There are two primary ways to get your code onto the OCI instance. **Option A (Git) is highly recommended** for easier updates.

### Option A: Using Git (Recommended)
1.  **On Local Machine**: Ensure your code is pushed to a private repository (GitHub, GitLab, etc.).
2.  **On OCI Instance**:
    ```bash
    # Generate an SSH key on the server (if your repo is private)
    ssh-keygen -t ed25519
    cat ~/.ssh/id_ed25519.pub # Add this to your GitHub 'Deploy Keys'
    
    # Clone the repo
    git clone git@github.com:your-username/your-repo.git
    cd your-repo/backend
    ```

### Option B: Using Rsync (Direct Copy with Exclusions)
Since you want to exclude the large `seeds` directory, `rsync` is much better than `scp`. It is standard on macOS and Linux.

From your **local terminal** (in the root of your project):
```bash
# This copies the backend folder but EXCLUDES the large seeds directory
rsync -av --exclude='seeds' --exclude='venv' --exclude='__pycache__' ./backend/ tee-time:~/backend
```
*Note: The trailing slash on `./backend/` ensures we copy the **contents** into `~/backend` on the server.*

## IV. Server Environment Preparation

1.  **Connect via SSH**: `ssh -i <your-key> ubuntu@<oci-public-ip>`
2.  **Install Docker & Docker Compose**:
    ```bash
    sudo apt update && sudo apt install -y docker.io docker-compose
    sudo usermod -aG docker ubuntu
    # Log out and back in for group changes to take effect
    ```
3.  **Open Local OS Firewall**:
    OCI instances often have a local `iptables` or `ufw` running.
    ```bash
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 8000/tcp
    ```

## V. Backend Deployment (Dockerized)

1.  **Project Files**:
    *   Ensure you are in the `~/backend` directory.
2.  **Environment Variables**:
    *   Create the `.env` file: `nano .env`
    *   Paste your production keys (Supabase, RevenueCat, etc.).
3.  **Deploy**:
    ```bash
    # Build and start in detached mode
    docker-compose up --build -d
    ```

### 1. Identify and Insert the Rule
Standard OCI Ubuntu images have a strict firewall. Since we are using the standard web port (80), we need to open it:
```bash
# Insert the ALLOW rule for port 80 at the very top (position 1)
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT

# Save the rules so they persist after a reboot
sudo netfilter-persistent save
```

### 2. Verify it's there
Run this to see your firewall list. You should see `ACCEPT tcp -- anywhere anywhere tcp dpt:http` (which is port 80) at the very top:
```bash
sudo iptables -L INPUT --line-numbers
```

## VII. Frontend Updates (Mobile App)

1.  **Update API URL**:
    *   Open `frontend/tee-time-notify/.env`.
    *   Change `EXPO_PUBLIC_API_URL` to: `http://<oci-public-ip>` (no port needed for port 80).
2.  **IOS Exception (Optional)**:
    *   If using `http` (not `https`), you may need to add an `NSAppTransportSecurity` exception in `app.json` or `Info.plist` for your IP address, though it's recommended to use a domain with SSL (e.g., Nginx + Certbot).
3.  **Rebuild App**:
    ```bash
    npx expo start --clear
    ```

## V. Security & Scaling Checklist

- [ ] **Reverse Proxy**: Set up Nginx to forward port 80/443 to 8000.
- [ ] **SSL (HTTPS)**: Use Certbot to acquire a Let's Encrypt certificate.
- [ ] **Persistence**: Ensure `availability_cleanup_job` is running on Supabase (already done).
- [ ] **Monitoring**: Check logs via `docker-compose logs -f` to verify the scheduler is triggering on clock boundaries.
