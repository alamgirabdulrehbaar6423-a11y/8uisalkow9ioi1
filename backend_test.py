#!/usr/bin/env python3
"""
Backend test for Supabase Edge Function wake-up API (SPEED OPTIMIZATION retest)
Tests the deployed public URL over external HTTPS. No auth headers needed.
"""

import requests
import time
import json
from datetime import datetime

BASE_URL = "https://suwdzoycyeihbkhmpxay.supabase.co/functions/v1/wake-up"

def log_test(test_name, status, details=""):
    """Log test results with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    status_icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "ℹ️"
    print(f"\n[{timestamp}] {status_icon} {test_name}")
    if details:
        print(f"    {details}")

def test_health_warmup():
    """Test 1: WARM-UP + regression - GET /health twice to measure cold vs warm"""
    print("\n" + "="*80)
    print("TEST 1: WARM-UP + REGRESSION - GET /health")
    print("="*80)
    
    try:
        # First call (cold)
        start_time = time.time()
        response1 = requests.get(f"{BASE_URL}/health", timeout=10)
        latency1 = (time.time() - start_time) * 1000  # Convert to ms
        
        log_test("GET /health (cold)", "INFO", f"Status: {response1.status_code}, Latency: {latency1:.0f}ms")
        
        if response1.status_code != 200:
            log_test("GET /health (cold) - Status Code", "FAIL", f"Expected 200, got {response1.status_code}")
            print(f"Response body: {response1.text}")
            return False
        
        data1 = response1.json()
        print(f"    Response: {json.dumps(data1, indent=2)}")
        
        # Validate response structure
        if not data1.get("ok"):
            log_test("GET /health (cold) - Response 'ok' field", "FAIL", f"Expected ok:true, got {data1.get('ok')}")
            return False
        
        if data1.get("accountType") != "Trial":
            log_test("GET /health (cold) - Account Type", "FAIL", f"Expected 'Trial', got {data1.get('accountType')}")
            return False
        
        if data1.get("host") != "supabase-edge":
            log_test("GET /health (cold) - Host", "FAIL", f"Expected 'supabase-edge', got {data1.get('host')}")
            return False
        
        # Check CORS header
        cors_header = response1.headers.get("Access-Control-Allow-Origin")
        if cors_header != "*":
            log_test("GET /health (cold) - CORS Header", "FAIL", f"Expected '*', got {cors_header}")
            return False
        
        log_test("GET /health (cold) - All validations", "PASS", f"ok:true, accountType:Trial, host:supabase-edge, CORS:*")
        
        # Second call (warm - should be faster)
        time.sleep(0.5)  # Small delay between calls
        start_time = time.time()
        response2 = requests.get(f"{BASE_URL}/health", timeout=10)
        latency2 = (time.time() - start_time) * 1000  # Convert to ms
        
        log_test("GET /health (warm)", "INFO", f"Status: {response2.status_code}, Latency: {latency2:.0f}ms")
        
        if response2.status_code != 200:
            log_test("GET /health (warm) - Status Code", "FAIL", f"Expected 200, got {response2.status_code}")
            return False
        
        data2 = response2.json()
        log_test("GET /health (warm) - All validations", "PASS", f"Latency improved: {latency1:.0f}ms → {latency2:.0f}ms")
        
        print(f"\n📊 WARM-UP SUMMARY:")
        print(f"    Cold call: {latency1:.0f}ms")
        print(f"    Warm call: {latency2:.0f}ms")
        print(f"    Improvement: {latency1 - latency2:.0f}ms ({((latency1 - latency2) / latency1 * 100):.1f}%)")
        
        return True
        
    except requests.exceptions.RequestException as e:
        log_test("GET /health", "FAIL", f"Request error: {str(e)}")
        return False
    except Exception as e:
        log_test("GET /health", "FAIL", f"Unexpected error: {str(e)}")
        return False

def test_regression_endpoints():
    """Test 2: Regression tests for other endpoints"""
    print("\n" + "="*80)
    print("TEST 2: REGRESSION - Other Endpoints")
    print("="*80)
    
    all_passed = True
    
    # Test GET /twiml
    try:
        response = requests.get(f"{BASE_URL}/twiml", timeout=10)
        log_test("GET /twiml", "INFO", f"Status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("GET /twiml - Status Code", "FAIL", f"Expected 200, got {response.status_code}")
            all_passed = False
        elif "Good morning" not in response.text:
            log_test("GET /twiml - Content", "FAIL", "Expected 'Good morning' in XML")
            all_passed = False
        else:
            log_test("GET /twiml", "PASS", "Returns 200 with 'Good morning' XML")
            
    except Exception as e:
        log_test("GET /twiml", "FAIL", f"Error: {str(e)}")
        all_passed = False
    
    # Test GET /status with invalid callSid
    try:
        response = requests.get(f"{BASE_URL}/status?callSid=INVALID", timeout=10)
        log_test("GET /status?callSid=INVALID", "INFO", f"Status: {response.status_code}")
        
        if response.status_code != 400:
            log_test("GET /status?callSid=INVALID - Status Code", "FAIL", f"Expected 400, got {response.status_code}")
            all_passed = False
        else:
            data = response.json()
            if data.get("ok") is not False:
                log_test("GET /status?callSid=INVALID - Response", "FAIL", f"Expected ok:false, got {data}")
                all_passed = False
            else:
                log_test("GET /status?callSid=INVALID", "PASS", "Returns 400 {ok:false}")
                
    except Exception as e:
        log_test("GET /status?callSid=INVALID", "FAIL", f"Error: {str(e)}")
        all_passed = False
    
    # Test GET / (root - should return 404)
    try:
        response = requests.get(BASE_URL, timeout=10)
        log_test("GET / (root)", "INFO", f"Status: {response.status_code}")
        
        if response.status_code != 404:
            log_test("GET / (root) - Status Code", "FAIL", f"Expected 404, got {response.status_code}")
            all_passed = False
        else:
            log_test("GET / (root)", "PASS", "Returns 404 as expected")
            
    except Exception as e:
        log_test("GET / (root)", "FAIL", f"Error: {str(e)}")
        all_passed = False
    
    return all_passed

def test_speed_real_call():
    """Test 3: SPEED + REAL CALL TEST - Measure POST latency and time-to-ringing"""
    print("\n" + "="*80)
    print("TEST 3: SPEED + REAL CALL TEST")
    print("="*80)
    print("⚠️  WARNING: This will place ONE REAL phone call to the user's number")
    print("="*80)
    
    # Wait 2 seconds after health warm-up
    print("\n⏳ Waiting 2 seconds after health warm-up...")
    time.sleep(2)
    
    try:
        # POST to place the call and measure latency
        print(f"\n📞 Placing call via POST {BASE_URL}")
        post_start_time = time.time()
        post_timestamp = datetime.now()
        
        response = requests.post(BASE_URL, json={}, timeout=15)
        
        post_end_time = time.time()
        post_latency_ms = (post_end_time - post_start_time) * 1000
        
        log_test("POST / - Latency", "INFO", f"{post_latency_ms:.0f}ms (target: <1500ms, ideal: <1000ms)")
        
        if response.status_code != 201:
            log_test("POST / - Status Code", "FAIL", f"Expected 201, got {response.status_code}")
            print(f"Response body: {response.text}")
            return False
        
        data = response.json()
        print(f"    Response: {json.dumps(data, indent=2)}")
        
        # Validate response structure
        if not data.get("ok"):
            log_test("POST / - Response 'ok' field", "FAIL", f"Expected ok:true, got {data}")
            return False
        
        call_sid = data.get("callSid")
        if not call_sid or not call_sid.startswith("CA"):
            log_test("POST / - callSid", "FAIL", f"Expected callSid starting with 'CA', got {call_sid}")
            return False
        
        if data.get("status") != "queued":
            log_test("POST / - Initial status", "FAIL", f"Expected 'queued', got {data.get('status')}")
            return False
        
        if data.get("trialMode") is not True:
            log_test("POST / - trialMode", "FAIL", f"Expected trialMode:true, got {data.get('trialMode')}")
            return False
        
        log_test("POST / - Response validation", "PASS", f"callSid:{call_sid}, status:queued, trialMode:true")
        
        # Performance check
        if post_latency_ms < 1000:
            log_test("POST / - Performance", "PASS", f"Excellent: {post_latency_ms:.0f}ms < 1000ms")
        elif post_latency_ms < 1500:
            log_test("POST / - Performance", "PASS", f"Good: {post_latency_ms:.0f}ms < 1500ms")
        else:
            log_test("POST / - Performance", "FAIL", f"Slow: {post_latency_ms:.0f}ms >= 1500ms")
        
        # Poll status every 1 second for up to 45 seconds
        print(f"\n📊 Polling status for callSid: {call_sid}")
        print("    Tracking time-to-ringing and status transitions...")
        
        status_transitions = []
        time_to_ringing = None
        poll_count = 0
        max_polls = 45
        
        while poll_count < max_polls:
            poll_count += 1
            time.sleep(1)
            
            poll_timestamp = datetime.now()
            seconds_elapsed = (poll_timestamp - post_timestamp).total_seconds()
            
            try:
                status_response = requests.get(f"{BASE_URL}/status?callSid={call_sid}", timeout=10)
                
                if status_response.status_code != 200:
                    log_test(f"Status poll #{poll_count}", "FAIL", f"Expected 200, got {status_response.status_code}")
                    continue
                
                status_data = status_response.json()
                current_status = status_data.get("status")
                
                # Record transition if status changed
                if not status_transitions or status_transitions[-1]["status"] != current_status:
                    transition = {
                        "status": current_status,
                        "seconds_elapsed": round(seconds_elapsed, 1),
                        "timestamp": poll_timestamp.strftime("%H:%M:%S")
                    }
                    status_transitions.append(transition)
                    print(f"    [{transition['timestamp']}] +{transition['seconds_elapsed']}s → {current_status}")
                    
                    # Record time-to-ringing
                    if current_status == "ringing" and time_to_ringing is None:
                        time_to_ringing = seconds_elapsed
                        log_test("Time-to-ringing", "PASS", f"{time_to_ringing:.1f} seconds from POST to ringing")
                
                # Check for terminal status
                terminal_statuses = ["completed", "no-answer", "busy", "failed", "canceled"]
                if current_status in terminal_statuses:
                    log_test("Status polling", "INFO", f"Reached terminal status: {current_status}")
                    break
                    
            except Exception as e:
                log_test(f"Status poll #{poll_count}", "FAIL", f"Error: {str(e)}")
                continue
        
        # Summary
        print(f"\n📊 SPEED TEST SUMMARY:")
        print(f"    POST latency: {post_latency_ms:.0f}ms")
        print(f"    Time-to-ringing: {time_to_ringing:.1f}s" if time_to_ringing else "    Time-to-ringing: NOT REACHED")
        print(f"    Status transitions:")
        for t in status_transitions:
            print(f"      +{t['seconds_elapsed']}s → {t['status']}")
        
        return True
        
    except requests.exceptions.RequestException as e:
        log_test("POST /", "FAIL", f"Request error: {str(e)}")
        return False
    except Exception as e:
        log_test("POST /", "FAIL", f"Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all tests in sequence"""
    print("\n" + "="*80)
    print("SUPABASE EDGE FUNCTION WAKE-UP API - SPEED OPTIMIZATION RETEST")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    results = {
        "health_warmup": False,
        "regression": False,
        "speed_real_call": False
    }
    
    # Test 1: Health warm-up
    results["health_warmup"] = test_health_warmup()
    
    # Test 2: Regression
    results["regression"] = test_regression_endpoints()
    
    # Test 3: Speed + Real Call (only if previous tests passed)
    if results["health_warmup"] and results["regression"]:
        results["speed_real_call"] = test_speed_real_call()
    else:
        print("\n⚠️  Skipping real call test due to previous failures")
    
    # Final summary
    print("\n" + "="*80)
    print("FINAL SUMMARY")
    print("="*80)
    for test_name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{status} - {test_name}")
    
    print(f"\nTest completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    return all(results.values())

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
