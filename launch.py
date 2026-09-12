# -*- coding: utf-8 -*-
import os
import sys
import time
import socket
import subprocess
import webbrowser
import shutil

PORT = 8080
URL = f"http://localhost:{PORT}/"
D_DIR = r"D:\crofo-tg-client"
BACKEND_SCRIPT = os.path.join(D_DIR, "backend", "server.py")

def is_server_running(port):
    """Check if the local server is already running on the given port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

def get_python_command():
    """Resolve a valid python command to run scripts."""
    # Try the current executable first (if running raw python)
    if not getattr(sys, 'frozen', False):
        return sys.executable
        
    # Check for py or python in system
    for cmd in ["py", "python", "python3"]:
        if shutil.which(cmd):
            return cmd
            
    # Default fallbacks
    fallback_paths = [
        os.path.expandvars(r"%LocalAppData%\Programs\Python\Launcher\py.exe"),
        r"C:\Windows\py.exe"
    ]
    for path in fallback_paths:
        if os.path.exists(path):
            return path
            
    return "py"

def start_backend():
    """Start server.py silently in the background as a detached process."""
    if is_server_running(PORT):
        print("[OK] Backend server is already running.")
        return True
        
    python_cmd = get_python_command()
    print(f"[INIT] Resolved Python interpreter: {python_cmd}")
    print("[INIT] Starting CROFO Client backend server...")
    
    try:
        # Run backend server in background
        if sys.platform == "win32":
            # DETACHED_PROCESS ensures server continues running after launcher exits
            subprocess.Popen(
                [python_cmd, BACKEND_SCRIPT],
                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                cwd=os.path.dirname(BACKEND_SCRIPT)
            )
        else:
            subprocess.Popen(
                [python_cmd, BACKEND_SCRIPT],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                cwd=os.path.dirname(BACKEND_SCRIPT)
            )
        
        # Wait up to 10 seconds for the port to activate
        for _ in range(50):
            time.sleep(0.2)
            if is_server_running(PORT):
                print("[SUCCESS] Backend server online.")
                return True
        
        print("[WARNING] Server took too long to respond.")
        return False
    except Exception as e:
        print(f"[ERROR] Failed to start backend: {e}")
        return False

def launch_browser_app():
    """Launch Microsoft Edge or Chrome in borderless App Mode."""
    print("[LAUNCH] Loading interface in Desktop App Mode...")
    
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe")
    ]
    
    launched = False
    for path in edge_paths:
        if os.path.exists(path):
            try:
                # Open in app mode
                subprocess.Popen([path, f"--app={URL}"])
                print("[INFO] Launched in Microsoft Edge App Mode.")
                launched = True
                break
            except Exception:
                pass
                
    if not launched:
        # Fallback to Chrome
        chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe")
        ]
        
        for path in chrome_paths:
            if os.path.exists(path):
                try:
                    subprocess.Popen([path, f"--app={URL}"])
                    print("[INFO] Launched in Google Chrome App Mode.")
                    launched = True
                    break
                except Exception:
                    pass
                
    if not launched:
        # Default browser fallback
        print("[INFO] Falling back to default system browser.")
        webbrowser.open(URL)

def main():
    print("====================================================")
    print("        CROFO TELEGRAM CLIENT LAUNCHER")
    print("====================================================")
    
    # Start the backend server
    start_backend()
    
    # Start the browser window
    launch_browser_app()
    
    print("[FINISHED] Application successfully loaded.")
    time.sleep(1.5)

if __name__ == "__main__":
    main()
