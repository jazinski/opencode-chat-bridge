#!/bin/bash
# Run these commands on the PostgreSQL server (10.15.15.13)
# SSH as: ssh root@10.15.15.13 (password: chrisj)

echo "=== PostgreSQL pg_hba.conf Configuration ==="
echo ""

# Step 1: Find pg_hba.conf
echo "Step 1: Finding pg_hba.conf..."
PG_HBA=$(find /etc /var -name pg_hba.conf 2>/dev/null | head -1)

if [ -z "$PG_HBA" ]; then
  echo "ERROR: Could not find pg_hba.conf"
  echo "Try: locate pg_hba.conf"
  exit 1
fi

echo "Found: $PG_HBA"
echo ""

# Step 2: Backup the file
echo "Step 2: Creating backup..."
cp "$PG_HBA" "${PG_HBA}.backup.$(date +%Y%m%d-%H%M%S)"
echo "Backup created: ${PG_HBA}.backup.$(date +%Y%m%d-%H%M%S)"
echo ""

# Step 3: Add the entry
echo "Step 3: Adding entry for bot (10.0.0.169)..."

# Check if entry already exists
if grep -q "10.0.0.169" "$PG_HBA"; then
  echo "WARNING: Entry for 10.0.0.169 already exists!"
  echo "Current entries:"
  grep "10.0.0.169" "$PG_HBA"
else
  # Add the entry before the last line (usually a reject-all)
  # We'll add it after the "# IPv4 local connections:" section
  
  # Find line number of "# IPv4 local connections:"
  LINE=$(grep -n "# IPv4 local connections:" "$PG_HBA" | cut -d: -f1)
  
  if [ -n "$LINE" ]; then
    # Insert after that line
    sed -i "${LINE}a\\# OpenCode Chat Bridge\\nhost    opencode-chat    opencode-chat    10.0.0.169/32    md5" "$PG_HBA"
  else
    # Just append to end
    echo "" >> "$PG_HBA"
    echo "# OpenCode Chat Bridge" >> "$PG_HBA"
    echo "host    opencode-chat    opencode-chat    10.0.0.169/32    md5" >> "$PG_HBA"
  fi
  
  echo "Entry added successfully!"
fi
echo ""

# Step 4: Show the relevant section
echo "Step 4: Current configuration:"
echo "---"
grep -A 5 -B 5 "opencode-chat" "$PG_HBA" | grep -v "^--$"
echo "---"
echo ""

# Step 5: Check postgresql.conf for listen_addresses
echo "Step 5: Checking listen_addresses..."
PG_CONF=$(find /etc /var -name postgresql.conf 2>/dev/null | head -1)

if [ -n "$PG_CONF" ]; then
  echo "Found: $PG_CONF"
  LISTEN=$(grep "^listen_addresses" "$PG_CONF" || grep "^#listen_addresses" "$PG_CONF" | head -1)
  echo "Current setting: $LISTEN"
  
  if echo "$LISTEN" | grep -q "localhost"; then
    echo ""
    echo "WARNING: PostgreSQL only listening on localhost!"
    echo "Need to change listen_addresses to '*' or specific IP"
    echo ""
    echo "Run this command:"
    echo "  sed -i \"s/^#\?listen_addresses = .*/listen_addresses = '*'/\" \"$PG_CONF\""
    echo ""
    echo "Then restart: rc-service postgresql restart"
  fi
else
  echo "Could not find postgresql.conf"
fi
echo ""

# Step 6: Reload PostgreSQL
echo "Step 6: Reloading PostgreSQL..."
if command -v rc-service &> /dev/null; then
  rc-service postgresql reload
  echo "PostgreSQL reloaded (Alpine/OpenRC)"
elif command -v systemctl &> /dev/null; then
  systemctl reload postgresql
  echo "PostgreSQL reloaded (systemd)"
else
  echo "Please reload PostgreSQL manually"
fi
echo ""

echo "=== Configuration Complete ==="
echo ""
echo "Test connection from bot machine:"
echo "  psql 'postgresql://opencode-chat:opencode@10.15.15.13:5432/opencode-chat' -c 'SELECT version();'"
